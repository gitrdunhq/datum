import { model } from './models'
import type { TddStage } from './models'
import { CommitResult } from './types'
import { COMMIT_RESULT_SCHEMA } from './schemas'

// ── Rate-limit resilient agent wrapper ──────────────────────────────────────

const RATE_LIMIT_MAX_RETRIES = 4
const RATE_LIMIT_BASE_DELAY_MS = 5_000
const RATE_LIMIT_JITTER_MS = 2_000

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Independent commit verification (#274) ──────────────────────────────────
// A stage agent self-reports `committed` in its structured output. If it
// reports false, that's ambiguous: either it genuinely skipped the commit, or
// it committed correctly but mis-filled the schema field. Rather than trust
// the self-report blindly, check the worktree directly before failing the
// lane — a false negative here wastes a full retry/escalation cycle on work
// that already succeeded.
export interface CommitVerification {
  committed: boolean
  commitSha?: string
  clean?: boolean
  detail: string
}

export async function verifyCommitIndependently(
  taskId: string,
  wt: string,
  files: string[],
  commitPrefix: string,
  stage: string,
): Promise<CommitVerification> {
  const raw: string | null = await agent(
    `Run these two commands in order in "${wt}" and return their raw combined output, nothing else:\n` +
      `git -C "${wt}" log --format="%H %s"\n` +
      `git -C "${wt}" status --porcelain -- ${files.map((f) => `"${f}"`).join(' ')}\n` +
      `Return ONLY the raw output, no explanation, no markdown fences.`,
    { label: `verify-commit:${taskId}:${stage}`, model: 'haiku' },
  )
  if (!raw) return { committed: false, detail: 'independent check returned no result' }

  // A lane may have already progressed past this stage (RED -> GREEN ->
  // REFACTOR) by the time this check runs, so the target commit is not
  // necessarily HEAD — search the full log, not just `git log -1`.
  const lines = String(raw).trim().split('\n').filter(Boolean)
  const shaLine = /^[0-9a-f]{40} /
  const logLines = lines.filter((l) => shaLine.test(l))
  const statusLines = lines.filter((l) => !shaLine.test(l))
  const target = `${commitPrefix}: ${stage} complete`
  const match = logLines.find((l) => l.includes(target))
  const clean = statusLines.length === 0

  return {
    committed: Boolean(match) && clean,
    commitSha: match ? match.split(' ')[0] : '',
    clean,
    detail: match
      ? `found_commit="${match}" uncommitted_files=${statusLines.length}`
      : `no commit matching "${target}" found in history; uncommitted_files=${statusLines.length}`,
  }
}

// Injectable deps so resilientAgent's retry/backoff/dirty-guard logic can be
// exercised in unit tests without the sandbox's ambient `agent`/`log`
// globals. Production callers never pass this — it defaults to the real
// globals, so behavior is unchanged for every existing call site.
export interface ResilientAgentDeps {
  agentFn?: (prompt: string, opts?: AgentOpts) => Promise<any>
  logFn?: (message: string) => void
}

export async function resilientAgent(
  prompt: string,
  opts?: AgentOpts & { maxRetries?: number; worktree?: string },
  deps?: ResilientAgentDeps,
): Promise<any> {
  const agentFn = deps?.agentFn ?? agent
  const logFn = deps?.logFn ?? log
  const maxRetries = opts?.maxRetries ?? RATE_LIMIT_MAX_RETRIES
  let lastResult: any = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // A subagent that stalls mid-conversation and never calls
    // StructuredOutput (even after the runtime's in-conversation nudge) can
    // cause agent() to THROW rather than resolve to null (#332). Treat that
    // the same way we already treat a null result: retryable, subject to the
    // same dirty-worktree guard, never allowed to escape and crash the lane.
    let threw = false
    let caughtMessage = ''
    try {
      lastResult = await agentFn(prompt, opts)
    } catch (err) {
      threw = true
      caughtMessage = err instanceof Error ? err.message : String(err)
      lastResult = null
    }

    if (!threw && lastResult !== null) return lastResult

    if (threw) {
      logFn(`[resilientAgent] attempt ${attempt + 1} threw: ${caughtMessage} — treating as retryable`)
    }

    // If a worktree was provided, check for dirty state before retrying —
    // a null result (or a thrown error) after file writes means the agent
    // partially completed and a blind replay would duplicate work or create
    // extra commits.
    if (attempt < maxRetries && opts?.worktree) {
      const dirty = await agentFn(
        `Run: git -C "${opts.worktree}" status --porcelain\nReturn ONLY the raw output, no explanation.`,
        { label: 'retry-guard', model: 'haiku' },
      )
      if (dirty && dirty.trim().length > 0) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : 'returned null'} but worktree is dirty — aborting retry to prevent duplicate writes`)
        return lastResult
      }
    }

    if (attempt < maxRetries) {
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt)
        + Math.floor(Math.random() * RATE_LIMIT_JITTER_MS)
      const reason = threw ? `threw: ${caughtMessage}` : 'returned null'
      logFn(`[resilientAgent] attempt ${attempt + 1} ${reason}, backing off ${Math.round(delay / 1000)}s before retry ${attempt + 2}/${maxRetries + 1}`)
      await sleepMs(delay)
    }
  }

  return lastResult
}

// ── Git agents (single-writer pattern) ──────────────────────────────────────

export async function commitStage(
  taskId: string,
  wt: string,
  commitPrefix: string,
  allowedFiles: string[],
  stage: TddStage | string,
): Promise<CommitResult | null> {
  const allowedList = allowedFiles.join(', ')
  const basePrompt =
    `You are a GIT COMMIT agent. You ONLY handle git operations — never edit source files.\n\n` +
    `TASK:\n` +
    `1. Run: git -C "${wt}" status --porcelain\n` +
    `2. Verify ONLY these files were modified: ${allowedList}\n` +
    `3. If files outside that list were changed, report them as violations and do NOT commit\n` +
    `4. Stage the allowed files: git -C "${wt}" add <files>\n` +
    `5. Commit: git -C "${wt}" commit -m "${commitPrefix}: ${stage} complete"\n` +
    `6. Return the commit SHA from: git -C "${wt}" rev-parse --short HEAD\n\n` +
    `CONSTRAINTS:\n` +
    `- NEVER edit, create, or delete source files — only git operations\n` +
    `- If there are no changes to commit, return committed=false\n` +
    `- Use git -C "${wt}" for ALL git commands to enforce directory`

  let result = await agent(basePrompt, {
    label: `git-${stage.toLowerCase()}:${taskId}`,
    phase: 'Act',
    model: model('fast'),
    schema: COMMIT_RESULT_SCHEMA,
  })

  if (result && result.violations && result.violations.length > 0) {
    log(`[${taskId}] GIT ${stage}: file ownership violations: ${result.violations.join(', ')}`)
  }

  if (!result || (!result.committed && result.failure_reason)) {
    log(`[${taskId}] GIT ${stage}: haiku failed (${(result && result.failure_reason) || 'null'}), escalating to sonnet`)
    result = await agent(
      basePrompt +
        `\n\nRETRY CONTEXT: Previous commit attempt failed: ${(result && result.failure_reason) || 'null result'}.\n` +
        `Diagnose the git state: run git -C "${wt}" status, git -C "${wt}" diff --stat, git -C "${wt}" log --oneline -3.\n` +
        `Fix any issues (merge conflicts, dirty index, detached HEAD) then commit.\n` +
        `If the worktree is in a broken state, report failure_reason with details.`,
      {
        label: `git-${stage.toLowerCase()}-fix:${taskId}`,
        phase: 'Act',
        model: model('balanced'),
        schema: COMMIT_RESULT_SCHEMA,
      },
    )
  }

  if (result && result.committed) {
    log(`[${taskId}] GIT ${stage} committed: ${result.commit_sha || '(no sha)'}`)
    log(`[${taskId}]   staged: ${(result.files_staged || []).join(', ') || '(none reported)'}`)
  } else {
    log(`[${taskId}] GIT ${stage} FAILED: ${(result && result.failure_reason) || 'no commit after escalation'}`)
  }

  return result
}

