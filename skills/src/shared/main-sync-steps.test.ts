// main-sync-steps.ts replaces the LLM main-sync relay (mainSyncPrompt,
// shared/utils.ts, retired) with a deterministic batch. These tests run the
// real batch script against hermetic temp git repos (mirrors
// skills/src/datum-go.test.ts's fixture helpers) — an origin bare repo plus
// a working clone standing in for the epic branch checkout.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mainSyncSteps, mainSyncFromSteps } from './main-sync-steps'
import { batchScript, parseBatchResult, type BatchResult } from './batch'

function run(cmd: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status: number | null; stdout?: Buffer | string; stderr?: Buffer | string }
    return { status: e.status ?? 1, stdout: e.stdout ? e.stdout.toString() : '', stderr: e.stderr ? e.stderr.toString() : '' }
  }
}

function configureRepo(dir: string): void {
  // Hermetic: a machine-global core.hooksPath must not fire in these throwaway
  // repos (see datum-go.test.ts's initRepo comment).
  run('git', ['config', 'core.hooksPath', '/dev/null'], dir)
  run('git', ['config', 'user.email', 'test@example.com'], dir)
  run('git', ['config', 'user.name', 'Test User'], dir)
}

let bareDir: string
let repoDir: string
let cloneDir: string

beforeEach(() => {
  // origin as a bare repo.
  bareDir = mkdtempSync(join(tmpdir(), 'datum-mainsync-bare-'))
  run('git', ['init', '-q', '--bare', '-b', 'main'], bareDir)

  // Seed origin/main via a throwaway working clone.
  const seedDir = mkdtempSync(join(tmpdir(), 'datum-mainsync-seed-'))
  run('git', ['init', '-q', '-b', 'main'], seedDir)
  configureRepo(seedDir)
  writeFileSync(join(seedDir, 'README.md'), '# fixture\n')
  run('git', ['add', '.'], seedDir)
  run('git', ['commit', '-q', '-m', 'initial commit'], seedDir)
  run('git', ['remote', 'add', 'origin', bareDir], seedDir)
  run('git', ['push', '-q', 'origin', 'main'], seedDir)
  rmSync(seedDir, { recursive: true, force: true })

  // The epic branch checkout under test: a clone of origin.
  repoDir = mkdtempSync(join(tmpdir(), 'datum-mainsync-repo-'))
  run('git', ['clone', '-q', bareDir, repoDir], tmpdir())
  configureRepo(repoDir)

  // A second clone used to advance origin/main independently of repoDir.
  cloneDir = mkdtempSync(join(tmpdir(), 'datum-mainsync-clone-'))
  run('git', ['clone', '-q', bareDir, cloneDir], tmpdir())
  configureRepo(cloneDir)
})

afterEach(() => {
  const opts = { recursive: true, force: true, maxRetries: 5, retryDelay: 50 } as const
  rmSync(bareDir, opts)
  rmSync(repoDir, opts)
  rmSync(cloneDir, opts)
})

function advanceOriginMain(fileName: string, content: string): void {
  writeFileSync(join(cloneDir, fileName), content)
  run('git', ['add', '.'], cloneDir)
  run('git', ['commit', '-q', '-m', `advance: ${fileName}`], cloneDir)
  run('git', ['push', '-q', 'origin', 'main'], cloneDir)
}

function runSync(noMergeMain: boolean): BatchResult {
  const steps = mainSyncSteps(noMergeMain)
  const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd: repoDir, encoding: 'utf8' })
  return parseBatchResult(out, steps)
}

describe('mainSyncSteps', () => {
  it('always includes fetch and behind; includes merge only when !noMergeMain', () => {
    expect(mainSyncSteps(false).map((s) => s.name)).toEqual(['fetch', 'behind', 'merge'])
    expect(mainSyncSteps(true).map((s) => s.name)).toEqual(['fetch', 'behind'])
  })

  it('the merge step is tolerant and runs git merge --abort on failure', () => {
    const merge = mainSyncSteps(false).find((s) => s.name === 'merge')!
    expect(merge.tolerant).toBe(true)
    expect(merge.command).toContain('git merge --no-edit origin/main')
    expect(merge.command).toContain('git merge --abort')
    expect(merge.command).not.toMatch(/\bexit\b/)
  })
})

describe('mainSyncFromSteps — real git fixtures', () => {
  it('in sync: behind=0, merged=false, conflict=false', () => {
    const result = runSync(false)
    const sync = mainSyncFromSteps(result, false)
    expect(sync).toEqual({ behind: 0, merged: false, conflict: false })
  })

  it('behind + merge (default): fetches, counts behind, merges cleanly', () => {
    advanceOriginMain('a.txt', 'a\n')
    advanceOriginMain('b.txt', 'b\n')
    const result = runSync(false)
    const sync = mainSyncFromSteps(result, false)
    expect(sync.behind).toBe(2)
    expect(sync.merged).toBe(true)
    expect(sync.conflict).toBe(false)
    // The merge actually landed in the working tree.
    const log = run('git', ['log', '--oneline'], repoDir)
    expect(log.stdout.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(3)
  })

  it('behind + --no-merge-main: reports behind count, never merges', () => {
    advanceOriginMain('a.txt', 'a\n')
    const result = runSync(true)
    const sync = mainSyncFromSteps(result, true)
    expect(sync).toEqual({ behind: 1, merged: false, conflict: false })
    // No merge commit landed.
    const log = run('git', ['log', '--oneline'], repoDir)
    expect(log.stdout).not.toMatch(/advance: a\.txt/)
  })

  it('merge conflict: aborts cleanly, reports conflict=true, tree is not left conflicted', () => {
    // Diverge: origin/main and the epic branch both modify the same line.
    advanceOriginMain('shared.txt', 'from origin\n')
    writeFileSync(join(repoDir, 'shared.txt'), 'from epic\n')
    run('git', ['add', '.'], repoDir)
    run('git', ['commit', '-q', '-m', 'epic change'], repoDir)

    const result = runSync(false)
    const sync = mainSyncFromSteps(result, false)
    expect(sync.behind).toBe(1)
    expect(sync.merged).toBe(false)
    expect(sync.conflict).toBe(true)
    expect(sync.output).toBeTruthy()

    // The tree must never be left mid-conflict.
    const status = run('git', ['status', '--porcelain'], repoDir)
    expect(status.stdout.trim()).toBe('')
    const mergeInProgress = run('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], repoDir)
    expect(mergeInProgress.status).not.toBe(0)
  })

  it('fetch failure: no origin remote configured — named main_sync_failed, never "treat as in sync"', () => {
    run('git', ['remote', 'remove', 'origin'], repoDir)
    const result = runSync(false)
    expect(() => mainSyncFromSteps(result, false)).toThrow(/main_sync_failed/)
  })

  it('a missing/unparseable batch throws main_sync_failed, never a fabricated result', () => {
    const missing = parseBatchResult(null, mainSyncSteps(false))
    expect(() => mainSyncFromSteps(missing, false)).toThrow(/main_sync_failed/)
  })

  it('a failed fetch step is caught by name even when a later step somehow carries a valid behind count — never silently falls through to "in sync"', () => {
    // Hand-built BatchResult: fetch failed (this IS what result.failed points
    // at), but a 'behind' step with a real, parseable count is also present
    // — the kind of shape parseBatchResult() itself would never emit from a
    // real batch script (it stops at the first non-tolerant failure), but a
    // caller must not rely on that invariant. Distinguishes the explicit
    // result.failed guard from the NaN-parse fallback below it.
    const hand = {
      steps: [
        { name: 'fetch', exit_code: 1, stdout: '', stderr: 'fatal: could not read from remote' },
        { name: 'behind', exit_code: 0, stdout: '3', stderr: '' },
      ],
      failed: { name: 'fetch', exit_code: 1, stdout: '', stderr: 'fatal: could not read from remote' },
      missing: false,
    }
    // Must name "fetch" specifically — not silently succeed with the bogus
    // behind=3 the later step carries, and not report a generic parse error.
    expect(() => mainSyncFromSteps(hand, false)).toThrow(/main_sync_failed.*fetch/)
  })
})
