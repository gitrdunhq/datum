// main-sync-steps.ts — deterministic replacement for the LLM main-sync relay
// (mainSyncPrompt, retired #368 item 2): an agent used to run `git fetch`,
// count how far behind main the epic branch was, merge (unless
// --no-merge-main) and self-report {behind, merged, conflict} JSON that
// evaluateMainSync (shared/utils.ts) then judged. Nothing verified that
// self-report was honest.
//
// mainSyncSteps() builds the same three shell operations as ONE datum-cli
// batch (shared/batch.ts); mainSyncFromSteps() reduces the batch's real exit
// codes into the SAME MainSyncResult shape evaluateMainSync already
// consumes, so evaluateMainSync itself — and its tests — are unchanged.
//
// `fetch` and `behind` are non-tolerant: a batch that never reaches them, or
// whose fetch fails, must never be read as "0 behind" (a silent "treat as
// in sync"). mainSyncFromSteps throws a named `main_sync_failed:` error in
// that case instead of fabricating a MainSyncResult — the caller degrades
// this to `{ ok: false, message }` (see datum-validate.ts), matching how a
// behind-without-merge or a real merge conflict already fails loud today.
//
// `merge` is tolerant: a merge conflict is a legitimate, expected outcome to
// record, not a batch-stopping error — but the conflict must never be left
// on disk, so the step's own command runs `git merge --abort` on failure
// before mainSyncFromSteps ever sees the batch.
// tested-by: skills/src/shared/main-sync-steps.test.ts

import type { BatchStep, BatchResult } from './batch'
import { stepResult, stepStdout, describeFailure } from './batch'
import type { MainSyncResult } from './utils'

export function mainSyncSteps(noMergeMain: boolean): BatchStep[] {
  const steps: BatchStep[] = [
    { name: 'fetch', command: 'git fetch origin main' },
    { name: 'behind', command: 'BEHIND=$(git rev-list --count HEAD..origin/main); echo "$BEHIND"' },
  ]
  if (!noMergeMain) {
    steps.push({
      name: 'merge',
      command: [
        'if [ "${BEHIND:-0}" -gt 0 ]; then',
        '  if git merge --no-edit origin/main; then',
        '    true',
        '  else',
        '    git merge --abort',
        '    false',
        '  fi',
        'else',
        '  echo "not behind, nothing to merge"',
        'fi',
      ].join('\n'),
      tolerant: true,
    })
  }
  return steps
}

/**
 * Reduce a mainSyncSteps() BatchResult into MainSyncResult. Throws a named
 * `main_sync_failed:` error (never a fabricated "in sync" result) when the
 * batch produced nothing parseable, `fetch` failed, or `behind`'s output
 * isn't a real integer. A real merge conflict is NOT thrown here — it comes
 * back as `{ conflict: true }`, exactly as evaluateMainSync already expects.
 */
export function mainSyncFromSteps(result: BatchResult, noMergeMain: boolean): MainSyncResult {
  if (result.missing) {
    throw new Error('main_sync_failed: batch agent returned no parseable result for main-sync')
  }
  if (result.failed) {
    throw new Error(`main_sync_failed: ${describeFailure(result, 'main-sync')}`)
  }
  const behindRaw = (stepStdout(result, 'behind') || '').trim()
  const behind = parseInt(behindRaw, 10)
  if (!Number.isFinite(behind)) {
    throw new Error(`main_sync_failed: could not parse behind-count output from \`git rev-list --count HEAD..origin/main\` ("${behindRaw}")`)
  }
  if (noMergeMain || behind === 0) {
    return { behind, merged: false, conflict: false }
  }
  const mergeStep = stepResult(result, 'merge')
  if (!mergeStep) {
    throw new Error('main_sync_failed: merge step did not run')
  }
  if (mergeStep.exit_code === 0) {
    return { behind, merged: true, conflict: false }
  }
  const output = (mergeStep.stderr || mergeStep.stdout || '').trim().split('\n').slice(-20).join('\n')
  return { behind, merged: false, conflict: true, output }
}
