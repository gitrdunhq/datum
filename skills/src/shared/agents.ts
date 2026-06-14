import { CommitResult } from './types'
import { COMMIT_RESULT_SCHEMA } from './schemas'

// ── Git agents (single-writer pattern) ──────────────────────────────────────

export async function commitStage(
  taskId: string,
  wt: string,
  commitPrefix: string,
  allowedFiles: string[],
  stage: string,
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
    model: 'haiku',
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
        model: 'sonnet',
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

