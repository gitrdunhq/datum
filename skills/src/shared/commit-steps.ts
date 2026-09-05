// commit-steps.ts — deterministic "commit exactly these files with exactly
// this message" and "reset a worktree to its last commit" batches.
//
// Replaces the GIT COMMIT agent (commitStage): a datum-cli runner with a
// 3-turn budget told to run status → add → commit had no turn left to
// return its result, so the harness threw and killed the whole run (eedom
// wf_b1c88e09-036, BUG G) — and it copied attribution trailers from the
// harness reminder into the commit message (BUG H). A `git commit -m` with
// the exact message, run as one batch, can do neither; the script trusts
// the exit code and the printed sha.
// tested-by: skills/src/shared/commit-steps.test.ts

import { stepResult, stepStdout, describeFailure, type BatchResult, type BatchStep } from './batch'

const q = (s: string): string => `"${s.replace(/(["\\`$])/g, '\\$1')}"`

export interface CommitFilesOpts {
  wt: string
  files: string[]
  /** The whole commit message, verbatim. No trailers, no quotes. */
  message: string
}

const NOTHING_TO_COMMIT = 'NOTHING_TO_COMMIT'

export function commitFilesSteps(o: CommitFilesOpts): BatchStep[] {
  if (/co-authored-by|claude-session|signed-off-by/i.test(o.message)) {
    throw new Error(`commit message must not carry a trailer (policy): ${JSON.stringify(o.message)}`)
  }
  if (/["`$\\]/.test(o.message)) {
    throw new Error(`commit message must not contain quotes, backticks, $ or backslashes: ${JSON.stringify(o.message)}`)
  }
  if (o.files.length === 0) throw new Error('commitFilesSteps: no files to commit')
  const wt = q(o.wt)
  const files = o.files.map(q).join(' ')
  return [
    { name: 'status', command: `git -C ${wt} status --porcelain -- ${files}`, tolerant: true },
    { name: 'add', command: `git -C ${wt} add -- ${files}` },
    {
      name: 'commit',
      command: `if git -C ${wt} diff --cached --quiet -- ${files}; then echo ${NOTHING_TO_COMMIT}; else git -C ${wt} commit -q -m ${q(o.message)} -- ${files} && echo COMMITTED; fi`,
      tolerant: true,
    },
    { name: 'sha', command: `git -C ${wt} rev-parse --short HEAD`, tolerant: true },
  ]
}

export interface CommitFilesResult {
  committed: boolean
  nothingToCommit: boolean
  sha: string
  error: string
}

export function commitFilesFromSteps(result: BatchResult): CommitFilesResult {
  const none: CommitFilesResult = { committed: false, nothingToCommit: false, sha: '', error: '' }
  if (result.missing) return { ...none, error: `commit_failed: batch returned no parseable result (${describeFailure(result, 'commit')})` }
  const add = stepResult(result, 'add')
  if (!add || add.exit_code !== 0) {
    return { ...none, error: `commit_failed: git add exited ${add ? add.exit_code : 'without running'}: ${((add && (add.stderr || add.stdout)) || '').trim().split('\n').slice(-3).join(' | ')}` }
  }
  const commit = stepResult(result, 'commit')
  if (!commit) return { ...none, error: 'commit_failed: commit step did not run' }
  const out = (commit.stdout || '').trim()
  if (out.split('\n').includes(NOTHING_TO_COMMIT)) return { ...none, nothingToCommit: true }
  if (commit.exit_code !== 0) {
    return { ...none, error: `commit_failed: git commit exited ${commit.exit_code}: ${(commit.stderr || commit.stdout || '').trim().split('\n').slice(-3).join(' | ')}` }
  }
  const sha = (stepStdout(result, 'sha') || '').trim()
  if (!sha) return { ...none, error: 'commit_failed: commit exited 0 but no sha was printed' }
  return { committed: true, nothingToCommit: false, sha, error: '' }
}

/**
 * Return a worktree to its last commit: tracked edits discarded, untracked
 * files removed. Used before re-dispatching a stage whose first attempt
 * returned nothing (turn cap / API error) and may have left half-applied
 * edits behind — a retry must start from the lane's last commit, not from
 * an unknown mix of the previous attempt's work.
 */
export function worktreeResetSteps(wt: string): BatchStep[] {
  return [
    { name: 'reset', command: `git -C ${q(wt)} reset --hard HEAD`, tolerant: true },
    { name: 'clean', command: `git -C ${q(wt)} clean -fd`, tolerant: true },
    { name: 'status', command: `git -C ${q(wt)} status --porcelain`, tolerant: true },
  ]
}

/**
 * resilientAgent's retry guard: is the worktree dirty after a null/thrown
 * stage attempt? One tolerant `git status --porcelain` step. It used to be a
 * runner told to "Run: git status" and echo the output — an echoed "" (or a
 * null reply) for a dirty tree let the retry replay onto half-applied edits.
 */
export function worktreeDirtySteps(wt: string): BatchStep[] {
  return [{ name: 'status', command: `git -C ${q(wt)} status --porcelain`, tolerant: true }]
}

export interface WorktreeDirtyResult {
  /** True when the tree has changes — or when its state could not be established. */
  dirty: boolean
  /** False when the batch was missing or git exited non-zero: unknown is never clean. */
  known: boolean
  /** Status lines when dirty; a retry_guard_unverified reason when unknown. */
  detail: string
}

export function worktreeDirtyFromSteps(result: BatchResult): WorktreeDirtyResult {
  if (result.missing) {
    return { dirty: true, known: false, detail: `retry_guard_unverified: ${describeFailure(result, 'status')}` }
  }
  const step = stepResult(result, 'status')
  if (!step || step.exit_code !== 0) {
    const tail = ((step && (step.stderr || step.stdout)) || '').trim().split('\n').slice(-3).join(' | ')
    return { dirty: true, known: false, detail: `retry_guard_unverified: git status exited ${step ? step.exit_code : 'without running'}${tail ? ` — ${tail}` : ''}` }
  }
  const lines = (step.stdout || '').split('\n').filter((l) => l.trim().length > 0)
  return { dirty: lines.length > 0, known: true, detail: lines.join(' | ') }
}

/**
 * Sibling of worktreeResetSteps() that resets to an explicit sha rather than
 * HEAD — used when a lane's committed GREEN turns out to be stale (#331): an
 * independent intake-verify found the suite red at the lane's current HEAD,
 * so the worktree must go back to the RED commit (not HEAD, which IS the
 * rejected GREEN) before GREEN is re-dispatched.
 */
/**
 * Pin the worktree's HEAD to `ref` before a reset that would discard it.
 * A GREEN judged green_edited_tests was `reset --hard` away and survived
 * only in the reflog (caliper BUG P, 558b2ab was the correct final
 * implementation); with the ref it is recoverable by name.
 */
export function preserveHeadRefSteps(wt: string, ref: string): BatchStep[] {
  return [{ name: 'preserve', command: `git -C ${q(wt)} branch -f ${q(ref)} HEAD`, tolerant: true }]
}

export function worktreeResetToSteps(wt: string, sha: string): BatchStep[] {
  return [
    { name: 'reset', command: `git -C ${q(wt)} reset --hard ${q(sha)}`, tolerant: true },
    { name: 'clean', command: `git -C ${q(wt)} clean -fd`, tolerant: true },
    { name: 'status', command: `git -C ${q(wt)} status --porcelain`, tolerant: true },
    { name: 'head', command: `git -C ${q(wt)} rev-parse HEAD`, tolerant: true },
    // Resolved so a ref (the epic branch) can be the target, not only a sha.
    { name: 'target', command: `git -C ${q(wt)} rev-parse ${q(`${sha}^{commit}`)}`, tolerant: true },
  ]
}

/**
 * Did the reset actually land? A refused `git reset` (host permission
 * classifier) still comes back as a parsed batch with a non-zero tolerant
 * step, so "the batch parsed" is no evidence (elonchesd wf_2b0230c2-f41
 * task-016 dispatched RED on the un-reset worktree). The gate is: HEAD is
 * the requested sha and the tree is clean.
 */
export function worktreeResetToFromSteps(result: BatchResult, sha: string): { ok: boolean; error: string } {
  if (result.missing) return { ok: false, error: `worktree_reset_failed: ${describeFailure(result, 'reset-to-red')}` }
  const head = stepStdout(result, 'head')
  if (head === null) return { ok: false, error: `worktree_reset_failed: the head step did not run — cannot confirm where the worktree is (steps returned: ${result.steps.map((st) => `${st.name}=${st.exit_code}`).join(', ') || 'none'})` }
  const got = head.trim()
  const resolved = (stepStdout(result, 'target') || '').trim() || sha
  if (got !== sha && got !== resolved) {
    const reset = stepResult(result, 'reset')
    const why = reset && reset.exit_code !== 0 ? ` (reset exited ${reset.exit_code}: ${(reset.stderr || reset.stdout || '').trim().slice(0, 200)})` : ''
    return { ok: false, error: `worktree_reset_failed: HEAD is ${got || '?'}, expected ${sha}${why}` }
  }
  const dirty = (stepStdout(result, 'status') || '').trim()
  if (dirty) return { ok: false, error: `worktree_reset_failed: worktree still dirty after reset to ${sha}: ${dirty.split('\n').length} path(s)` }
  return { ok: true, error: '' }
}
