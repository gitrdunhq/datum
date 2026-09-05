import { model } from './models'
import type { TddStage } from './models'
import { CommitResult } from './types'
import { COMMIT_RESULT_SCHEMA } from './schemas'
import { stageOpts } from './agent-types'
import { batchCommandPrompt, parseBatchResult, stepStdout, describeFailure, type BatchStep } from './batch'

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

/**
 * Pure decision over the two step outputs: the lane's log (`<base>..HEAD`,
 * `%H %s`) and `git status --porcelain` for the stage's files. A lane may
 * already have progressed past this stage (RED -> GREEN -> REFACTOR) when the
 * check runs, so the target commit is searched anywhere in the lane's log.
 */
export function parseCommitVerification(
  logStdout: string | null | undefined,
  statusStdout: string | null | undefined,
  commitPrefix: string,
  stage: string,
): CommitVerification {
  if (logStdout === null || logStdout === undefined) {
    return { committed: false, detail: 'independent check returned no result (log step did not run)' }
  }
  const shaLine = /^[0-9a-f]{40} /
  const logLines = String(logStdout).split('\n').map((l) => l.trim()).filter((l) => shaLine.test(l))
  const statusLines = String(statusStdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
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

/**
 * Did the stage agent really commit? Runs as a datum-cli batch (never an LLM
 * echo of raw git output) with the log BOUNDED to the lane's own commits —
 * an unbounded `git log` was 90 KB in a real consumer repo and the relay
 * truncated it (726dbd8). `baseRef` is the epic branch; when absent the log
 * is capped at 200 entries.
 */
export async function verifyCommitIndependently(
  taskId: string,
  wt: string,
  files: string[],
  commitPrefix: string,
  stage: string,
  baseRef?: string,
): Promise<CommitVerification> {
  const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`
  const range = baseRef ? `${q(baseRef)}..HEAD` : '-n 200'
  const steps: BatchStep[] = [
    { name: 'log', command: `git -C ${q(wt)} log --format="%H %s" ${range}`, tolerant: true },
    { name: 'status', command: `git -C ${q(wt)} status --porcelain -- ${files.map(q).join(' ')}`, tolerant: true },
  ]
  const raw = await agent(
    batchCommandPrompt(steps),
    stageOpts('cli', { label: `verify-commit:${taskId}:${stage}`, model: model('fast') }),
  )
  const result = parseBatchResult(raw, steps)
  if (result.missing) return { committed: false, detail: `independent check returned no result (${describeFailure(result, 'verify-commit')})` }
  return parseCommitVerification(stepStdout(result, 'log'), stepStdout(result, 'status'), commitPrefix, stage)
}

// Injectable deps so resilientAgent's retry/backoff/dirty-guard logic can be
// exercised in unit tests without the sandbox's ambient `agent`/`log`
// globals. Production callers never pass this — it defaults to the real
// globals, so behavior is unchanged for every existing call site.
export interface ResilientAgentDeps<T = unknown> {
  agentFn?: (prompt: string, opts?: AgentOpts) => Promise<T>
  logFn?: (message: string) => void
}

export async function resilientAgent<T = unknown>(
  prompt: string,
  opts?: AgentOpts & { maxRetries?: number; worktree?: string },
  deps?: ResilientAgentDeps<T>,
): Promise<T | null> {
  const agentFn = deps?.agentFn ?? agent
  const logFn = deps?.logFn ?? log
  const maxRetries = opts?.maxRetries ?? RATE_LIMIT_MAX_RETRIES
  let lastResult: T | null = null

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
        stageOpts('cli', { label: 'retry-guard', model: 'haiku' }),
      )
      if (dirty && String(dirty).trim().length > 0) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : 'returned null'} but worktree is dirty — aborting retry to prevent duplicate writes`)
        return lastResult
      }
    }

    if (attempt < maxRetries) {
      // Deterministic jitter: the Workflow runtime throws on Math.random()
      // (it would break resume), which would have killed the run on the
      // very retry meant to recover it. Spread by attempt index instead.
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt)
        + ((attempt + 1) * 7919) % RATE_LIMIT_JITTER_MS
      const reason = threw ? `threw: ${caughtMessage}` : 'returned null'
      logFn(`[resilientAgent] attempt ${attempt + 1} ${reason}, backing off ${Math.round(delay / 1000)}s before retry ${attempt + 2}/${maxRetries + 1}`)
      await sleepMs(delay)
    }
  }

  return lastResult
}

// ── Git agents (single-writer pattern) ──────────────────────────────────────

export interface CommitStageOptions {
  /**
   * 'strict' (default): any modified file outside allowedFiles is a violation
   * and nothing is committed — right for lane worktrees, where no one but the
   * agent writes. 'allowed-only': stage and commit only allowedFiles and
   * ignore every other modified file — right for the ROOT checkout, which
   * carries the operator's unrelated work in progress (policy chosen with the
   * eedom dogfooding user after docs-sync commits were refused over WIP in
   * AGENTS.md/CLAUDE.md).
   */
  scope?: 'strict' | 'allowed-only'
}

export async function commitStage(
  taskId: string,
  wt: string,
  commitPrefix: string,
  allowedFiles: string[],
  stage: TddStage | string,
  opts: CommitStageOptions = {},
): Promise<CommitResult | null> {
  const allowedList = allowedFiles.join(', ')
  const scope = opts.scope ?? 'strict'
  const verifySteps = scope === 'allowed-only'
    ? `2. This commit runs in the ROOT checkout, which may carry the operator's unrelated work in progress. IGNORE other modified files entirely — they are NOT violations and must NOT be staged.\n` +
      `3. Only these files are yours to commit: ${allowedList}. If none of them is modified, return committed=false.\n`
    : `2. Verify ONLY these files were modified: ${allowedList}\n` +
      `3. If files outside that list were changed, report them as violations and do NOT commit\n`
  const basePrompt =
    `You are a GIT COMMIT agent. You ONLY handle git operations — never edit source files.\n\n` +
    `TASK:\n` +
    `1. Run: git -C "${wt}" status --porcelain\n` +
    verifySteps +
    `4. Stage the allowed files: git -C "${wt}" add <files>\n` +
    `5. Commit: git -C "${wt}" commit -m "${commitPrefix}: ${stage} complete"\n` +
    `6. Return the commit SHA from: git -C "${wt}" rev-parse --short HEAD\n\n` +
    `CONSTRAINTS:\n` +
    `- NEVER edit, create, or delete source files — only git operations\n` +
    `- If there are no changes to commit, return committed=false\n` +
    `- Use git -C "${wt}" for ALL git commands to enforce directory`

  let result: CommitResult | null = await agent(basePrompt, stageOpts('cli', {
    label: `git-${stage.toLowerCase()}:${taskId}`,
    phase: 'Act',
    model: model('fast'),
    schema: COMMIT_RESULT_SCHEMA,
  }))

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
      stageOpts('cli', {
        label: `git-${stage.toLowerCase()}-fix:${taskId}`,
        phase: 'Act',
        model: model('balanced'),
        schema: COMMIT_RESULT_SCHEMA,
      }),
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

