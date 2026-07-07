// Tests task path-boundary-file-ownership: R2 — Path-boundary matching in
// verifyFileOwnership (#269).
//
// RED phase — none of these behaviors exist yet:
//  - There is no exported, directly-testable path-boundary matcher for
//    verifyFileOwnership's allow/forbid logic. The lane runner
//    (skills/src/datum-tdd-act-lane.ts) is a sandbox workflow script whose
//    top-level body expects host-injected globals (`args`, `agent`, `phase`,
//    ...) — it cannot be `import`-ed directly in a plain test runner. Per the
//    existing convention in this codebase (skills/src/shared/utils.ts /
//    utils.test.ts hold the pure, directly-testable helpers), the fix must
//    export a pure `verifyFileOwnership(changed, allowedFiles, forbiddenFiles)`
//    matcher from './shared/utils' that datum-tdd-act-lane.ts's
//    verifyFileOwnership() calls into for the actual path-matching decision.
//  - Today there is no such export, so importing it is undefined and calling
//    it throws.
//  - Once it exists, its matching logic must NOT use suffix/substring
//    comparisons (`fb.endsWith(f) || fb.endsWith(f)`-style) — those treat
//    "NewFoo.test.ts" as matching the allowed file "Foo.test.ts" because
//    "NewFoo.test.ts".endsWith("Foo.test.ts") is true. Matching must be
//    exact-path (or explicit path-boundary aware), not a suffix collision.
// All assertions below are expected to fail until GREEN implements and wires
// up this export.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import * as utils from './shared/utils'

const repoRoot = join(__dirname, '..', '..')

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

function getVerifyFileOwnership():
  | ((changed: string[], allowedFiles: string[], forbiddenFiles?: string[]) => { ok: boolean; violations: string[] })
  | undefined {
  return (utils as Record<string, unknown>).verifyFileOwnership as
    | ((changed: string[], allowedFiles: string[], forbiddenFiles?: string[]) => { ok: boolean; violations: string[] })
    | undefined
}

// ---------------------------------------------------------------------------
// AC1 — suffix collision must NOT count as an allowed match.
// ---------------------------------------------------------------------------

describe('path-boundary-file-ownership — AC1', () => {
  it('flags NewFoo.test.ts as a violation when only Foo.test.ts is allowed (suffix collision)', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    const result = verifyFileOwnership!(['NewFoo.test.ts'], ['Foo.test.ts'], [])

    // The suffix collision ("NewFoo.test.ts".endsWith("Foo.test.ts")) must NOT
    // be treated as a match against the allowed file — this is a real
    // violation, not an allowed change.
    expect(result.ok).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some((v) => v.includes('NewFoo.test.ts'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC2 — exact path match is allowed, no violation.
// ---------------------------------------------------------------------------

describe('path-boundary-file-ownership — AC2', () => {
  it('reports no file_ownership_violation for an exact path match', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    const result = verifyFileOwnership!(['src/Foo.test.ts'], ['src/Foo.test.ts'], [])

    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AC3 — a genuinely unrelated changed file is still flagged.
// ---------------------------------------------------------------------------

describe('path-boundary-file-ownership — AC3', () => {
  it('still flags an unrelated changed file as a violation', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    const result = verifyFileOwnership!(['src/Unrelated.ts'], ['src/Foo.test.ts'], [])

    expect(result.ok).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some((v) => v.includes('src/Unrelated.ts'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC4 — the fix must live in the TS source and the compiled bundle must be
// regenerated via scripts/build-workflows.sh, never hand-edited.
// ---------------------------------------------------------------------------

describe('path-boundary-file-ownership — AC4', () => {
  it('verifyFileOwnership is exported from shared/utils.ts, wired into the lane runner, and the JS bundle is rebuilt from source', () => {
    const utilsSource = readFileSync(join(__dirname, 'shared', 'utils.ts'), 'utf8')
    // The path-boundary matcher must be a real, directly-testable export —
    // not left as private, sandbox-only logic inline in the lane runner.
    expect(utilsSource).toMatch(/export\s+function\s+verifyFileOwnership/)

    const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
    // The lane runner's verifyFileOwnership() must delegate the actual
    // matching decision to the shared, tested helper rather than keeping its
    // own separate suffix-matching loop.
    expect(laneSource).toMatch(/verifyFileOwnership/)

    const buildResult = run('bash', ['scripts/build-workflows.sh'], repoRoot)
    expect(buildResult.status).toBe(0)

    const bundled = readFileSync(join(repoRoot, 'skills', 'datum-tdd-act-lane.js'), 'utf8')
    expect(bundled.startsWith('// @generated — DO NOT EDIT. Source: skills/src/')).toBe(true)
  })
})
