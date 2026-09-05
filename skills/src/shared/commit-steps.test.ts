// Deterministic root-checkout commit + worktree reset steps.
//
// Dogfooding (eedom run wf_b1c88e09-036):
// - BUG G: the docs-sync GIT COMMIT agent (datum-cli, maxTurns 3) was told
//   to run status → add → commit — three tool calls, its whole budget — so it
//   never had a turn left to return the StructuredOutput, the harness threw,
//   and the ENTIRE datum-go run died with no Act summary. The commit itself
//   had landed.
// - BUG H: that agent copied the harness attribution reminder into the
//   commit message (Co-Authored-By / Claude-Session trailers), which the
//   consuming repo's policy forbids. A deterministic `git commit -m` with the
//   exact message cannot do that.
// - BUG F: a GREEN agent that hit its turn cap left half-applied edits in
//   the lane worktree, and the escalation retry inherited them.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchScript, parseBatchResult, type BatchResult } from './batch'
import { commitFilesSteps, commitFilesFromSteps, worktreeResetSteps, worktreeResetToSteps, worktreeResetToFromSteps, worktreeDirtySteps, worktreeDirtyFromSteps } from './commit-steps'

function fake(stdouts: Record<string, string>, exits: Record<string, number> = {}): BatchResult {
  const steps = Object.entries(stdouts).map(([name, stdout]) => ({ name, exit_code: exits[name] ?? 0, stdout, stderr: '' }))
  const failed = steps.find((s) => s.exit_code !== 0 && s.name === 'add') || null
  return { steps, failed: failed ? failed.name : null, missing: false } as BatchResult
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function tempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'datum-commit-'))
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'core.hooksPath', '/dev/null')
  git(dir, 'config', 'user.email', 't@example.com')
  git(dir, 'config', 'user.name', 'T')
  git(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'README.md'), 'hi\n')
  git(dir, 'add', 'README.md')
  git(dir, 'commit', '-q', '-m', 'init')
  return dir
}

describe('commitFilesSteps', () => {
  it('stages ONLY the named files, commits with the exact message, and reports the sha — status/add/commit/sha', () => {
    const steps = commitFilesSteps({ wt: '.', files: ['docs/a.md', 'docs/b.md'], message: 'docs(run-1): sync' })
    expect(steps.map((s) => s.name)).toEqual(['status', 'add', 'commit', 'sha'])
    expect(steps[1].command).toContain('git -C "." add -- "docs/a.md" "docs/b.md"')
    expect(steps[1].command).not.toMatch(/add -A|add \./)
    expect(steps[2].command).toContain('-m "docs(run-1): sync"')
    expect(steps[2].command).not.toMatch(/Co-Authored|Claude-Session/)
    // `nothing to commit` is a legitimate outcome, not a failed step.
    expect(steps[2].command).toContain('NOTHING_TO_COMMIT')
    expect(steps[2].tolerant).toBe(true)
  })

  it('refuses a message that would smuggle a trailer', () => {
    expect(() => commitFilesSteps({ wt: '.', files: ['a'], message: 'x\n\nCo-Authored-By: someone' })).toThrow(/trailer/)
    expect(() => commitFilesSteps({ wt: '.', files: ['a'], message: 'x"; rm -rf /' })).toThrow(/quote/)
  })
})

describe('commitFilesFromSteps', () => {
  it('committed=true with the sha when the commit step exited 0 and printed a sha', () => {
    const r = fake({ status: ' M docs/a.md', add: '', commit: '[main abc1234] docs', sha: 'abc1234' })
    expect(commitFilesFromSteps(r)).toEqual({ committed: true, nothingToCommit: false, sha: 'abc1234', error: '' })
  })

  it('committed=false, nothingToCommit=true when the tree had nothing staged — a rerun after a landed commit', () => {
    const r = fake({ status: '', add: '', commit: 'NOTHING_TO_COMMIT', sha: 'abc1234' })
    expect(commitFilesFromSteps(r)).toEqual({ committed: false, nothingToCommit: true, sha: '', error: '' })
  })

  it('names the failing step when add/commit fail; a missing batch is a named failure, never "committed"', () => {
    const r = fake({ status: '', add: 'fatal: pathspec did not match' }, { add: 128 })
    const out = commitFilesFromSteps(r)
    expect(out.committed).toBe(false)
    expect(out.error).toMatch(/commit_failed/)
    expect(commitFilesFromSteps({ steps: [], failed: null, missing: true }).error).toMatch(/commit_failed.*no parseable result/)
  })
})

describe('worktreeResetSteps', () => {
  it('discards tracked edits AND untracked files so a retry starts from the lane\'s last commit', () => {
    const steps = worktreeResetSteps('/wt')
    expect(steps.map((s) => s.name)).toEqual(['reset', 'clean', 'status'])
    expect(steps[0].command).toContain('git -C "/wt" reset --hard HEAD')
    expect(steps[1].command).toContain('git -C "/wt" clean -fd')
  })
})

// resilientAgent's retry guard: is the worktree dirty after a null/thrown
// stage attempt? Used to be a runner told to "Run: git status --porcelain"
// and echo the output — an echoed "" (or a null reply) for a dirty tree let
// the retry replay onto half-applied edits. One tolerant step; unknown is
// never treated as clean.
describe('worktreeDirtySteps / worktreeDirtyFromSteps', () => {
  it('is a single tolerant git status --porcelain step', () => {
    const steps = worktreeDirtySteps('/wt')
    expect(steps.map((s) => s.name)).toEqual(['status'])
    expect(steps[0].command).toBe('git -C "/wt" status --porcelain')
    expect(steps[0].tolerant).toBe(true)
  })

  it('reports dirty:true with the status lines when porcelain output is non-empty', () => {
    const r = worktreeDirtyFromSteps(fake({ status: ' M src/a.ts\n?? new.ts\n' }))
    expect(r).toEqual({ dirty: true, known: true, detail: ' M src/a.ts | ?? new.ts' })
  })

  it('reports dirty:false, known:true for an empty porcelain output with exit 0', () => {
    expect(worktreeDirtyFromSteps(fake({ status: '' }))).toEqual({ dirty: false, known: true, detail: '' })
  })

  it('a missing batch or a non-zero git exit is known:false (never clean) with a retry_guard_unverified detail', () => {
    const missing = worktreeDirtyFromSteps(parseBatchResult(null, worktreeDirtySteps('/wt')))
    expect(missing.known).toBe(false)
    expect(missing.dirty).toBe(true)
    expect(missing.detail).toMatch(/^retry_guard_unverified: /)
    const crashed = worktreeDirtyFromSteps(fake({ status: 'fatal: not a git repository' }, { status: 128 }))
    expect(crashed.known).toBe(false)
    expect(crashed.detail).toMatch(/^retry_guard_unverified: .*128/)
  })
})

describe('worktreeResetToSteps', () => {
  it('resets to the given sha (not HEAD) then cleans, reports status and the resulting HEAD — sibling of worktreeResetSteps', () => {
    const steps = worktreeResetToSteps('/wt', 'abc1234')
    expect(steps.map((s) => s.name)).toEqual(['reset', 'clean', 'status', 'head', 'target'])
    expect(steps[3].command).toBe('git -C "/wt" rev-parse HEAD')
    // The target is resolved too, so a ref (epic branch) works as well as a sha.
    expect(steps[4].command).toBe('git -C "/wt" rev-parse "abc1234^{commit}"')
    expect(steps[0].command).toContain('git -C "/wt" reset --hard "abc1234"')
    expect(steps[0].command).not.toContain('HEAD')
    expect(steps[1].command).toContain('git -C "/wt" clean -fd')
  })

  it('under real bash: returns the tree to the named sha, discarding a later (stale GREEN) commit entirely', () => {
    const dir = tempRepo()
    try {
      writeFileSync(join(dir, 'a.py'), 'red\n')
      git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'red(T1): RED complete')
      const redSha = git(dir, 'rev-parse', 'HEAD')
      writeFileSync(join(dir, 'a.py'), 'stale green\n')
      git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'green(T1): GREEN complete')

      const steps = worktreeResetToSteps(dir, redSha)
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(r.steps.find((s) => s.name === 'status')!.stdout.trim()).toBe('')
      expect(git(dir, 'rev-parse', 'HEAD')).toBe(redSha)
      expect(git(dir, 'log', '-1', '--format=%s')).toBe('red(T1): RED complete')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('end-to-end under real bash', () => {
  it('commits exactly the named files with the exact message (no trailers), leaves other WIP unstaged, and is a no-op second time', () => {
    const dir = tempRepo()
    try {
      writeFileSync(join(dir, 'docs.md'), 'docs\n')
      writeFileSync(join(dir, 'README.md'), 'operator WIP\n')
      const steps = commitFilesSteps({ wt: dir, files: ['docs.md'], message: 'docs(run-1): sync' })
      const first = commitFilesFromSteps(parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps))
      expect(first.committed).toBe(true)
      expect(first.sha).toMatch(/^[0-9a-f]{7,}$/)
      expect(git(dir, 'log', '-1', '--format=%B').trim()).toBe('docs(run-1): sync')
      expect(git(dir, 'show', '--stat', '--format=', 'HEAD')).toContain('docs.md')
      expect(git(dir, 'show', '--stat', '--format=', 'HEAD')).not.toContain('README.md')
      expect(git(dir, 'status', '--porcelain')).toBe('M README.md')
      const second = commitFilesFromSteps(parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps))
      expect(second).toEqual({ committed: false, nothingToCommit: true, sha: '', error: '' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('worktreeResetSteps returns the tree to HEAD: tracked edits gone, new files gone, status empty', () => {
    const dir = tempRepo()
    try {
      writeFileSync(join(dir, 'README.md'), 'half-applied edit\n')
      writeFileSync(join(dir, 'new_impl.py'), 'partial\n')
      const steps = worktreeResetSteps(dir)
      const r = parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      expect(r.steps.find((s) => s.name === 'status')!.stdout.trim()).toBe('')
      expect(git(dir, 'status', '--porcelain')).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// elonchesd wf_2b0230c2-f41 task-016: the host classifier refused the reset
// batch but the runner still returned a JSON array (reset step non-zero,
// tolerant), so `resetToRedResult.missing` was false and RED was dispatched
// on the un-reset worktree; task-013's runner answered in prose and stopped.
// The gate must be "HEAD is the RED sha and the tree is clean", not "the
// batch parsed".
describe('worktreeResetToFromSteps', () => {
  const sha = 'a'.repeat(40)
  const mk = (over: Record<string, { exit_code?: number; stdout?: string }>) => parseBatchResult(JSON.stringify(
    ['reset', 'clean', 'status', 'head', 'target'].map((name) => ({ name, exit_code: over[name]?.exit_code ?? 0, stdout: over[name]?.stdout ?? (name === 'head' || name === 'target' ? sha + '\n' : ''), stderr: '' })),
  ), worktreeResetToSteps('/wt', sha))

  it('ok only when HEAD equals the target sha and status is empty', () => {
    expect(worktreeResetToFromSteps(mk({}), sha)).toEqual({ ok: true, error: '' })
  })

  it('a refused/failed reset that left HEAD elsewhere is worktree_reset_failed naming both shas', () => {
    const r = worktreeResetToFromSteps(mk({ reset: { exit_code: 1, stdout: 'blocked' }, head: { stdout: 'b'.repeat(40) + '\n' } }), sha)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(new RegExp(`^worktree_reset_failed: HEAD is ${'b'.repeat(40)}, expected ${sha}`))
  })

  it('a dirty tree after the reset, a missing head step, or a missing batch are all worktree_reset_failed', () => {
    expect(worktreeResetToFromSteps(mk({ status: { stdout: ' M a.py\n' } }), sha).error).toMatch(/^worktree_reset_failed: .*still dirty/)
    const noHead = parseBatchResult(JSON.stringify([{ name: 'reset', exit_code: 0, stdout: '', stderr: '' }]), worktreeResetToSteps('/wt', sha))
    expect(worktreeResetToFromSteps(noHead, sha).error).toMatch(/^worktree_reset_failed: .*head step/)
    // A ref target: HEAD must equal what the ref resolves to, not the literal.
    const refSteps = worktreeResetToSteps('/wt', 'datum/e')
    const refOk = parseBatchResult(JSON.stringify(['reset', 'clean', 'status', 'head', 'target'].map((name) => ({ name, exit_code: 0, stdout: name === 'head' || name === 'target' ? 'c'.repeat(40) + '\n' : '', stderr: '' }))), refSteps)
    expect(worktreeResetToFromSteps(refOk, 'datum/e').ok).toBe(true)
    expect(worktreeResetToFromSteps(parseBatchResult('I cannot run destructive git commands', worktreeResetToSteps('/wt', sha)), sha).error).toMatch(/^worktree_reset_failed: .*runner_permission_denied/)
  })
})
