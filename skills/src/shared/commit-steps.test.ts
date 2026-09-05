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
import { commitFilesSteps, commitFilesFromSteps, worktreeResetSteps } from './commit-steps'

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
