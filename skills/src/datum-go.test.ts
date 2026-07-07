// Tests task adopt-existing-feature-branch: R4 — Bootstrap epic from an
// existing feature branch (#213).
//
// RED phase — none of these behaviors exist yet:
//  - `datum init` has no adopt-existing-branch path (no --json flag, no
//    epicBranch/lanePlanPath state emission, no unsafe-branch-state guard).
//  - skills/src/datum-go.ts's Act bootstrap still resolves the branch purely
//    via an agent prompt (detectBranchPrompt) — it never shells out to a CLI
//    adopt path.
// All assertions below are expected to fail until GREEN implements them.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Fixture helpers — build a throwaway git repo we can safely mutate.
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    const e = err as { status: number | null; stdout?: Buffer | string; stderr?: Buffer | string }
    return {
      status: e.status ?? 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
    }
  }
}

function initRepo(dir: string): void {
  run('git', ['init', '-q', '-b', 'main'], dir)
  run('git', ['config', 'user.email', 'test@example.com'], dir)
  run('git', ['config', 'user.name', 'Test User'], dir)
  writeFileSync(join(dir, 'README.md'), '# fixture repo\n')
  run('git', ['add', '.'], dir)
  run('git', ['commit', '-q', '-m', 'initial commit'], dir)
}

let repoDir: string

beforeEach(() => {
  repoDir = mkdtempSync(join(tmpdir(), 'datum-adopt-'))
  initRepo(repoDir)
})

afterEach(() => {
  rmSync(repoDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// AC1 — non-default branch, no TICKET.md/lane-plan artifacts -> adoption
// ---------------------------------------------------------------------------

describe('adopt-existing-feature-branch — AC1', () => {
  it('datum init --json on a non-default branch with no artifacts sets epicBranch to current branch and emits a lanePlanPath', () => {
    run('git', ['checkout', '-q', '-b', 'feature/existing-work'], repoDir)

    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).toBe(0)

    let parsed: { epicBranch?: string; lanePlanPath?: string; adopted?: boolean }
    expect(() => {
      parsed = JSON.parse(result.stdout)
    }).not.toThrow()

    expect(parsed!.epicBranch).toBe('feature/existing-work')
    expect(typeof parsed!.lanePlanPath).toBe('string')
    expect(parsed!.lanePlanPath!.length).toBeGreaterThan(0)
    expect(parsed!.adopted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC2 — unsafe/conflicting branch state -> non-zero exit, clear error
// ---------------------------------------------------------------------------

describe('adopt-existing-feature-branch — AC2', () => {
  it('datum init exits non-zero with a clear error when the branch has an unresolved merge conflict', () => {
    // Create a genuine unresolved merge conflict so MERGE_HEAD / conflict
    // markers are present in the working tree — an unsafe state to adopt.
    run('git', ['checkout', '-q', '-b', 'feature/conflicted'], repoDir)
    writeFileSync(join(repoDir, 'shared.txt'), 'from feature branch\n')
    run('git', ['add', '.'], repoDir)
    run('git', ['commit', '-q', '-m', 'feature change'], repoDir)

    run('git', ['checkout', '-q', 'main'], repoDir)
    writeFileSync(join(repoDir, 'shared.txt'), 'from main branch\n')
    run('git', ['add', '.'], repoDir)
    run('git', ['commit', '-q', '-m', 'main change'], repoDir)

    run('git', ['checkout', '-q', 'feature/conflicted'], repoDir)
    const mergeResult = run('git', ['merge', 'main'], repoDir)
    expect(mergeResult.status).not.toBe(0) // sanity: the merge really did conflict
    expect(existsSync(join(repoDir, '.git', 'MERGE_HEAD'))).toBe(true) // sanity: mid-conflict

    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).not.toBe(0)
    const combined = `${result.stdout}${result.stderr}`.toLowerCase()
    expect(combined).toContain('conflict')
  })
})

// ---------------------------------------------------------------------------
// AC3 — datum-go.ts's Act bootstrap must route through the CLI adopt path,
// not resolve the branch inline via an agent prompt / inline shell.
// ---------------------------------------------------------------------------

describe('adopt-existing-feature-branch — AC3', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('the Act bootstrap step invokes the CLI adopt path (datum init --json / --adopt)', () => {
    expect(src).toMatch(/datum\s+init\s+(--json|--adopt)/)
  })

  it('the Act bootstrap step no longer resolves branch/runId purely via the inline detectBranchPrompt agent call', () => {
    // Today the bootstrap step calls `agent(detectBranchPrompt, ...)` directly
    // with no CLI adopt fallback — that inline-only path must be gone once
    // bootstrap routes through the CLI adopt path.
    expect(src).not.toMatch(/agent\(detectBranchPrompt/)
  })
})

// ---------------------------------------------------------------------------
// AC4 — default branch, or artifacts already present -> adoption not
// triggered; existing behavior is preserved.
// ---------------------------------------------------------------------------

describe('adopt-existing-feature-branch — AC4', () => {
  it('datum init --json on the default branch does not report adoption', () => {
    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as { adopted?: boolean }
    expect(parsed.adopted).toBeFalsy()
  })

  it('datum init --json on a non-default branch with an existing TICKET.md does not report adoption and leaves TICKET.md untouched', () => {
    run('git', ['checkout', '-q', '-b', 'feature/already-planned'], repoDir)
    const epicDir = join(repoDir, 'docs', 'epics', 'feature', 'already-planned')
    mkdirSync(epicDir, { recursive: true })
    const ticketPath = join(epicDir, 'TICKET.md')
    const sentinel = '# Pre-existing ticket — do not overwrite\n'
    writeFileSync(ticketPath, sentinel)

    const result = run('datum', ['init', '--json'], repoDir)

    expect(result.status).toBe(0)
    const parsed = JSON.parse(result.stdout) as { adopted?: boolean }
    expect(parsed.adopted).toBeFalsy()
    expect(readFileSync(ticketPath, 'utf8')).toBe(sentinel)
  })
})
