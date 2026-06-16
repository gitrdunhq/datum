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

export async function resilientAgent(
  prompt: string,
  opts?: AgentOpts & { maxRetries?: number; worktree?: string },
): Promise<any> {
  const maxRetries = opts?.maxRetries ?? RATE_LIMIT_MAX_RETRIES
  let lastResult: any = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    lastResult = await agent(prompt, opts)

    if (lastResult !== null) return lastResult

    // If a worktree was provided, check for dirty state before retrying —
    // a null result after file writes means the agent partially completed
    // and a blind replay would duplicate work or create extra commits.
    if (attempt < maxRetries && opts?.worktree) {
      const dirty = await agent(
        `Run: git -C "${opts.worktree}" status --porcelain\nReturn ONLY the raw output, no explanation.`,
        { label: 'retry-guard', model: 'haiku' },
      )
      if (dirty && dirty.trim().length > 0) {
        log(`[resilientAgent] attempt ${attempt + 1} returned null but worktree is dirty — aborting retry to prevent duplicate writes`)
        return lastResult
      }
    }

    if (attempt < maxRetries) {
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt)
        + Math.floor(Math.random() * RATE_LIMIT_JITTER_MS)
      log(`[resilientAgent] attempt ${attempt + 1} returned null, backing off ${Math.round(delay / 1000)}s before retry ${attempt + 2}/${maxRetries + 1}`)
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

