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

// ---------------------------------------------------------------------------
// parseArgs — non-JSON free-text args must not be silently dropped (#319).
//
// Incident: a caller passed `--start-from act` as raw args. It wasn't valid
// JSON, wasn't "yolo", wasn't a bare issue number, so it fell into the catch
// branch and became `{ yolo: true, freeText: raw }` with zero indication
// anything was ignored. `startFrom` was never set, `explicitStart` stayed
// false, and the pipeline silently resumed from stale `completedPhases`
// state — skipping 7 bug-fix lanes with no warning.
//
// These tests exercise `parseArgs` in isolation (it's a pure string ->
// object function with no dependency on the sandbox globals `log`/`agent`/
// `workflow`, so we can extract and eval it directly from source) to lock
// in: (a) `--start-from <phase>` / `--route <route>` are recovered from
// free text, and (b) any remaining unrecognized free text triggers a loud
// warning via `log(...)` mentioning it was ignored.
// ---------------------------------------------------------------------------

describe('parseArgs — non-JSON free-text args (#319)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  // Extract the `parseArgs` function body from source and eval it in a
  // sandbox that captures `log(...)` calls, mirroring how the real workflow
  // sandbox injects `log` as an ambient global.
  function loadParseArgs(): { parseArgs: (raw: string) => Record<string, unknown>; logs: string[] } {
    const match = src.match(/function parseArgs\(raw: string\): Record<string, unknown> \{[\s\S]*?\n\}\n/)
    expect(match).not.toBeNull()
    const fnSrc = match![0]
      // strip TS-only annotations so this can run as plain JS via `new Function`
      .replace('function parseArgs(raw: string): Record<string, unknown> {', 'function parseArgs(raw) {')
      .replace(': Record<string, unknown>', '')

    const logs: string[] = []
    const factory = new Function('log', `${fnSrc}\nreturn parseArgs;`)
    const parseArgs = factory((msg: string) => logs.push(msg)) as (raw: string) => Record<string, unknown>
    return { parseArgs, logs }
  }

  it('recovers --start-from from non-JSON free text instead of silently dropping it', () => {
    const { parseArgs, logs } = loadParseArgs()
    const result = parseArgs('--start-from act')

    expect(result.startFrom).toBe('act')
    // A recognized flag was recovered — still log, but not the "IGNORED" warning.
    expect(logs.some((l) => l.includes('IGNORED'))).toBe(false)
  })

  it('recovers --route from non-JSON free text', () => {
    const { parseArgs } = loadParseArgs()
    const result = parseArgs('--route bugfix')

    expect(result.route).toBe('bugfix')
  })

  it('logs a loud warning when free text is neither JSON, yolo, an issue number, nor a recognized flag', () => {
    const { parseArgs, logs } = loadParseArgs()
    const raw = 'do something totally unrecognized'
    const result = parseArgs(raw)

    expect(result.freeText).toBe(raw)
    expect(result.startFrom).toBeUndefined()
    expect(result.route).toBeUndefined()
    expect(logs.some((l) => l.includes('WARNING') && l.includes(raw) && l.includes('IGNORED'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// #327 — preflight check that the globally installed `datum` uv tool editable
// link still resolves to this repo root, before any pipeline phase runs.
// ---------------------------------------------------------------------------

describe('preflight tool-install check (#327)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('checks the uv tool editable install direct_url.json against the repo root before running any phase', () => {
    expect(src).toMatch(/direct_url\.json/)
    expect(src).toMatch(/git rev-parse --show-toplevel/)
  })

  it('fails loud with a clear remediation message when the install is misdirected', () => {
    expect(src).toMatch(/throw new Error\(\s*`datum CLI tool install is stale\/misdirected/)
    expect(src).toMatch(/uv tool install --editable \. --force/)
  })

  it('the preflight check runs before the auto-resume / first phase logic', () => {
    const preflightIdx = src.indexOf('preflight-tool-check')
    const firstPhaseIdx = src.indexOf("shouldRun('refine', 0)")
    expect(preflightIdx).toBeGreaterThan(-1)
    expect(firstPhaseIdx).toBeGreaterThan(-1)
    expect(preflightIdx).toBeLessThan(firstPhaseIdx)
  })
})

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

// ---------------------------------------------------------------------------
// new-epic detection (#213 follow-up) — a freeText brief that clearly
// describes different work than the existing TICKET.md must trigger a new
// epic bootstrap instead of silently resuming the checked-out one.
//
// Incident: on a feature branch with its own TICKET.md from a prior epic,
// `datum go yolo "new brief"` resumed the existing epic because the
// bootstrap logic only ever checked "is TICKET.md missing?" — never whether
// the brief the caller just typed described a different piece of work.
// Fixing this by shelling out to a real LLM mid-test isn't practical, so
// these are source-string assertions (same convention as AC3 / #327 above)
// that lock in: the guard conditions, that it reuses the existing
// `datum init --name <slug>` CLI bootstrap path rather than a second
// mechanism, and that it runs before auto-resume decides to skip Refine.
// ---------------------------------------------------------------------------

describe('new-epic detection from freeText brief (#213 follow-up)', () => {
  const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

  it('only runs the new-epic check when freeText is present, prior state exists, and start was not explicit', () => {
    expect(src).toMatch(/if \(a\.freeText && priorState && !explicitStart\)/)
  })

  it('reuses the existing `datum init --name <slug>` bootstrap path rather than inventing a second mechanism', () => {
    expect(src).toMatch(/datum init --name <slug> --json/)
  })

  it('gates auto-resume on the new-epic decision so a detected new epic does not get skipped straight past Refine', () => {
    expect(src).toMatch(/if \(priorState && !explicitStart && !newEpicBranch\)/)
  })

  it('the new-epic check runs before the auto-resume block', () => {
    const newEpicIdx = src.indexOf('New-epic detection')
    const resumeIdx = src.indexOf('if (priorState && !explicitStart && !newEpicBranch)')
    expect(newEpicIdx).toBeGreaterThan(-1)
    expect(resumeIdx).toBeGreaterThan(-1)
    expect(newEpicIdx).toBeLessThan(resumeIdx)
  })

  it('bare `datum go yolo` (no freeText) never triggers the new-epic check, preserving existing resume behavior', () => {
    // Guard requires a.freeText to be truthy — parseArgs only sets freeText
    // in the catch-all branch, never for bare "yolo"/JSON/issue-number input.
    expect(src).toMatch(/a\.freeText && priorState && !explicitStart/)
    // `--start-from` explicitly set must also short-circuit the check,
    // preserving `--start-from`/`--route` resume behavior untouched.
    expect(src).toMatch(/explicitStart: boolean = !!a\.startFrom/)
  })
})
