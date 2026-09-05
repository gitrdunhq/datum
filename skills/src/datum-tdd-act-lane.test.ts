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

  it('does not match in reverse: a bare changed filename must not match a longer allowed path that merely ends with it (ARCH-001)', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    // "src/utils.ts".endsWith("/" + "utils.ts") is true, but a changed file
    // named "utils.ts" living at the repo root is NOT the same file as, nor
    // nested inside, "src/utils.ts" — matching must be one-directional
    // (changed file lives inside allowed path), never the reverse.
    const result = verifyFileOwnership!(['utils.ts'], ['src/utils.ts'], [])

    expect(result.ok).toBe(false)
    expect(result.violations.some((v) => v.includes('utils.ts'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// AC5 — issue #269 follow-up: a bare, extensionless allowed_write_files
// entry standing in for "this whole directory belongs to this lane" must
// match files scaffolded inside it (e.g. an SPM test target directory).
// ---------------------------------------------------------------------------

describe('path-boundary-file-ownership — AC5 (directory-boundary nesting)', () => {
  it('allows a file nested inside a bare directory-shaped allowed path', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    const allowed = ['docs/epics/e1/tests/CpdTableTests']
    const result = verifyFileOwnership!(
      ['docs/epics/e1/tests/CpdTableTests/Package.swift'],
      allowed,
      [],
    )

    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('allows a file nested inside an allowed directory written WITH a trailing slash (#393)', () => {
    // Lane plans legitimately list a directory as "tests/fixtures/part_corpus/"
    // (trailing slash, per its red_note). The matcher computed
    // `b + '/'` → "tests/fixtures/part_corpus//", which never matches, so
    // every fixture GREEN wrote was rejected as a file_ownership_violation
    // (eedom run wf_209d655c-095).
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    const result = verifyFileOwnership!(
      ['tests/fixtures/part_corpus/scenario_01_basic.json'],
      ['tests/fixtures/part_corpus/'],
      [],
    )

    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })

  it('a trailing-slash allowed entry still does not match a sibling-prefixed directory (#393)', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    const result = verifyFileOwnership!(
      ['tests/fixtures/part_corpus_extra/x.json'],
      ['tests/fixtures/part_corpus/'],
      [],
    )
    expect(result.ok).toBe(false)
  })

  it('allows a deeply nested file inside the allowed directory', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    const allowed = ['docs/epics/e1/tests/CpdTableTests']
    const result = verifyFileOwnership!(
      ['docs/epics/e1/tests/CpdTableTests/Tests/CpdTableTests/CpdTableTests.swift'],
      allowed,
      [],
    )

    expect(result.ok).toBe(true)
    expect(result.violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// AC6 — the directory-boundary match must be a real path-segment boundary,
// not a bare string prefix: a sibling directory whose name merely starts
// with the allowed directory's name must still be flagged as a violation.
// ---------------------------------------------------------------------------

describe('path-boundary-file-ownership — AC6 (sibling-prefix guard)', () => {
  it('still flags a sibling-prefixed path as a violation, not a directory match', () => {
    const verifyFileOwnership = getVerifyFileOwnership()
    expect(typeof verifyFileOwnership).toBe('function')

    const allowed = ['docs/epics/e1/tests/CpdTableTests']
    const result = verifyFileOwnership!(
      ['docs/epics/e1/tests/CpdTableTestsExtra/file.ts'],
      allowed,
      [],
    )

    expect(result.ok).toBe(false)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(
      result.violations.some((v) => v.includes('docs/epics/e1/tests/CpdTableTestsExtra/file.ts')),
    ).toBe(true)
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

// ---------------------------------------------------------------------------
// #357 — RED, GREEN and REFACTOR commits must all go through the single
// commit convention (laneCommitCommand): same author, same trailers, stage
// subjects. No stage prompt may hand-roll its own `git commit -m`.
// ---------------------------------------------------------------------------

describe('#357 — unified commit convention across RED/GREEN/REFACTOR', () => {
  const promptsDir = join(__dirname, 'prompts')
  const stagePrompts = ['red.md', 'red-retry.md', 'green.md', 'green-retry.md', 'refactor.md', 'commit.md']

  it('every stage prompt commits via the {{commitCmd}} placeholder, never a raw git commit', () => {
    for (const name of stagePrompts) {
      const text = readFileSync(join(promptsDir, name), 'utf8')
      expect(text, name).toMatch(/\{\{commitCmd\}\}/)
      expect(text, name).not.toMatch(/git -C "\{\{wt\}\}" commit -m/)
    }
  })

  it('the lane runner builds the commit command with laneCommitCommand for all three stages', () => {
    const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
    expect(laneSource).toMatch(/laneCommitCommand\(\{[^}]*stage:\s*'RED'/)
    expect(laneSource).toMatch(/laneCommitCommand\(\{[^}]*stage:\s*'GREEN'/)
    expect(laneSource).toMatch(/laneCommitCommand\(\{[^}]*stage:\s*'REFACTOR'/)
  })
})

// ---------------------------------------------------------------------------
// #356 — the lane runner must run the contract preflight at RED time (fail
// RED, not GREEN, on a contract contradiction), and route a blocked GREEN
// through decideGreenBlock instead of the blind opus retry.
// ---------------------------------------------------------------------------

describe('#356 — RED-time contract preflight and GREEN block routing', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  it('runs the contract preflight after RED is verified and before GREEN, failing RED on contract_conflict', () => {
    const preflightIdx = laneSource.indexOf('datum.contract_preflight')
    const greenIdx = laneSource.indexOf('greenPrompt(greenVars)')
    const redVerifiedIdx = laneSource.indexOf('RED verified')
    expect(preflightIdx).toBeGreaterThan(redVerifiedIdx)
    expect(preflightIdx).toBeLessThan(greenIdx)
    const block = laneSource.slice(preflightIdx, greenIdx)
    expect(block).toMatch(/stage: 'RED'[^\n]*contract_conflict/)
  })

  it('decides GREEN retry vs blocked with decideGreenBlock and returns needs_write on the outcome', () => {
    expect(laneSource).toMatch(/decideGreenBlock\(/)
    expect(laneSource).toMatch(/status: 'blocked',\s*stage: 'GREEN'/)
    expect(laneSource).toMatch(/needs_write:/)
  })

  it('auto-widens only in yolo mode and re-runs GREEN once', () => {
    expect(laneSource).toMatch(/autoWidenTargets\(/)
    expect(laneSource).toMatch(/cfg\.yolo/)
  })

  it('the GREEN prompt documents the structured blocked result', () => {
    const green = readFileSync(join(__dirname, 'prompts', 'green.md'), 'utf8')
    expect(green).toMatch(/status="blocked"|status: "blocked"|"status":\s*"blocked"/)
    expect(green).toMatch(/needs_write/)
  })
})

// ---------------------------------------------------------------------------
// Deterministic RED green-blindness gate: the RED agent's tests_pass is
// self-reported from a run it performed itself. The script must
// independently re-run the same test command and trust that result over the
// agent's self-report — a hallucinated "tests_pass: false" must not sail
// through the gate undetected.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Structural (docs-only / config-only) lanes: the runner's fast-path to
// REFACTOR read `lane.stage === 'structural'`, but every producer writes the
// lifecycle value `stage: "queued"` and nothing ever emitted 'structural' —
// the path was dead since the TS port and docs-only lanes always failed the
// RED count gate (#369). The flag is now a distinct `kind` field.
// ---------------------------------------------------------------------------

describe('structural lanes are keyed on lane.kind, not the lifecycle stage field', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const typesSource = readFileSync(join(__dirname, 'shared', 'types.ts'), 'utf8')

  it('the runner decides structural-ness from lane.kind', () => {
    expect(laneSource).toMatch(/lane\.kind === 'structural'/)
    expect(laneSource).not.toMatch(/lane\.stage === 'structural'/)
  })

  it('the Lane type declares kind as structural|behavioral and stage as the lifecycle string the producer writes', () => {
    expect(typesSource).toMatch(/kind\?: 'structural' \| 'behavioral'/)
    expect(typesSource).not.toMatch(/stage\?: 'structural' \| 'behavioral'/)
  })

  it('the planner prompt tells the model how to set kind', () => {
    const prompt = readFileSync(join(__dirname, 'prompts', 'plan-decompose.md'), 'utf8')
    expect(prompt).toMatch(/"kind"/)
    expect(prompt).toMatch(/structural/)
  })
})

// ---------------------------------------------------------------------------
// Lane intake must fail loud, never fall back to "fresh lane". In eedom run
// wf_70b84a20-f2a the intake batch's unbounded `git log` was 90 KB, the relay
// agent truncated it to nothing, the runner "continued with empty history",
// missed the lane's existing RED+GREEN commits (#331) and re-dispatched RED.
// ---------------------------------------------------------------------------

describe('lane intake: missing result is a hard failure, history is bounded', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  it('fails the lane with lane_intake_failed when the intake batch result is missing', () => {
    expect(laneSource).not.toMatch(/continuing with empty history/)
    expect(laneSource).toMatch(/lane_intake_failed/)
  })

  it('passes the epic branch to laneIntakeSteps so the history read is bounded to the lane', () => {
    expect(laneSource).toMatch(/laneIntakeSteps\(\{[\s\S]{0,300}epicBranch/)
  })

  it('passes the epic branch to postRedSteps so the count gate diffs from the merge-base, not HEAD~1', () => {
    expect(laneSource).toMatch(/postRedSteps\(\{[\s\S]{0,300}baseRef/)
  })
})

// ---------------------------------------------------------------------------
// Count-gate infrastructure failures must surface as their own error, never
// as a test count. In the field the gate script was missing (exit 127, empty
// stdout) and the digit-stripping fallback reported it as
// "no_new_test_functions_committed: found 0" — blaming the RED agent for a
// tooling failure.
// ---------------------------------------------------------------------------

describe('count-gate failures are distinct from a low count', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  it('returns count_gate_failed when the gate output is not the expected JSON', () => {
    expect(laneSource).toMatch(/count_gate_failed/)
  })

  it('has no digit-stripping fallback that turns arbitrary output into a count', () => {
    expect(laneSource).not.toMatch(/replace\(\/\[\^0-9\]\/g/)
  })
})

describe('deterministic RED green-blindness gate', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  it('passes verifyTestCmd to postRedSteps so the independent test-verify step runs', () => {
    expect(laneSource).toMatch(/postRedSteps\(\{[\s\S]{0,200}verifyTestCmd:\s*scopedTestCmd/)
  })

  it('fails RED on the independently re-run exit code, not only on the agent self-report', () => {
    const exitCheckIdx = laneSource.indexOf('redVerifyExit === 0')
    const selfReportIdx = laneSource.indexOf('if (red.tests_pass)')
    expect(exitCheckIdx).toBeGreaterThan(-1)
    expect(selfReportIdx).toBeGreaterThan(-1)
    // The deterministic check must run BEFORE the self-report is trusted,
    // so a false self-report cannot short-circuit past it.
    expect(exitCheckIdx).toBeLessThan(selfReportIdx)
  })
})

// ---------------------------------------------------------------------------
// Ownership check must fail CLOSED, not open. verifyFileOwnership() (the
// agent-based LLM check used when hooks are not installed) asked a `cli`
// agent to run `git diff --name-only HEAD~1 HEAD` and, on a null/empty/
// unparseable result, returned { ok: true, violations: [] } — a failed check
// reported as a clean one. A missing result is a named tooling failure, never
// "ok". Every caller must also be able to tell a tooling failure
// (ownership_check_failed) apart from a real violation (file_ownership_violation).
// ---------------------------------------------------------------------------

describe('ownership check fails closed, not open (agent-based verifyFileOwnership)', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  function ownershipFnBody(): string {
    const start = laneSource.indexOf('async function verifyFileOwnership(')
    expect(start).toBeGreaterThan(-1)
    const end = laneSource.indexOf('\n}\n', start)
    return laneSource.slice(start, end)
  }

  it('no longer returns { ok: true, violations: [] } for a missing/null result', () => {
    const body = ownershipFnBody()
    expect(body).not.toMatch(/if\s*\(!result\)\s*return\s*\{\s*ok:\s*true,\s*violations:\s*\[\]\s*\}/)
  })

  it('a missing/null result is reported as ok: false with an ownership_check_failed violation', () => {
    const body = ownershipFnBody()
    expect(body).toMatch(/ok:\s*false/)
    expect(body).toMatch(/ownership_check_failed/)
  })

  it('an unparseable (non-JSON, no files_changed) result is also treated as a check failure, not a clean pass', () => {
    const body = ownershipFnBody()
    // Must check that files_changed actually parsed as an array, not just
    // fall through to an empty [] that trivially passes verifyFileOwnershipMatch.
    expect(body).toMatch(/Array\.isArray\(.*files_changed/)
  })

  it('every !ok caller distinguishes a check failure (ownership_check_failed) from a real violation (file_ownership_violation)', () => {
    expect(laneSource).toMatch(/checkFailed/)
    // The old unconditional error template must be gone from both RED and GREEN call sites.
    expect(laneSource).not.toMatch(/error:\s*`file_ownership_violation:\s*\$\{redOwnership\.violations\.join\(', '\)\}`/)
    expect(laneSource).not.toMatch(/error:\s*`file_ownership_violation:\s*\$\{greenOwnership\.violations\.join\(', '\)\}`/)
  })

  it('a check-failure error string starts with ownership_check_failed, never file_ownership_violation', () => {
    expect(laneSource).toMatch(/checkFailed\s*\?\s*'ownership_check_failed'\s*:\s*'file_ownership_violation'/)
  })
})

// ---------------------------------------------------------------------------
// The skeptic panel's verdict must be consumed, not just logged. A
// cross-validated BROKEN verdict must feed the confirmed bugs into one GREEN
// retry (reusing greenRetryPrompt) and independently re-verify (test-verify +
// a second skeptic pass) before the lane is allowed to proceed to REFACTOR.
// FRAGILE stays log-only.
// ---------------------------------------------------------------------------

describe('skeptic verdict is consumed: a cross-validated BROKEN verdict retries GREEN', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  it('feeds confirmed bugs into a GREEN retry via greenRetryPrompt, using a SKEPTIC FINDINGS block', () => {
    expect(laneSource).toMatch(/greenRetryPrompt\(/)
    expect(laneSource).toMatch(/SKEPTIC FINDINGS/)
  })

  it('independently re-verifies after the retry (test-verify, not just the agent self-report)', () => {
    const skepticIdx = laneSource.indexOf('SKEPTIC FINDINGS')
    expect(skepticIdx).toBeGreaterThan(-1)
    const after = laneSource.slice(skepticIdx)
    expect(after).toMatch(/postGreenSteps\(/)
  })

  it('fails the lane with skeptic_broken and a confirmed-bug count if still BROKEN after the retry', () => {
    expect(laneSource).toMatch(/skeptic_broken:\s*\$\{/)
  })
})

describe('deterministic GREEN green-blindness gate (#386)', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  it('passes verifyTestCmd to postGreenSteps so the independent test-verify step runs', () => {
    expect(laneSource).toMatch(/postGreenSteps\(\{[\s\S]{0,200}verifyTestCmd:\s*scopedTestCmd/)
  })

  it('computes greenVerifyExit from the test-verify step, not just the agent self-report', () => {
    expect(laneSource).toMatch(/greenVerifyExit\s*=\s*testExitCode\(/)
  })

  it('fails GREEN on a non-zero/null independent exit even when green.tests_pass is true, before the final self-report trust that settles pass/fail after retries', () => {
    const exitCheckIdx = laneSource.indexOf('greenVerifyExit !== 0')
    // The final settle-point (post-retries) that trusts the self-report and
    // returns a GREEN-failed result — distinct from the earlier retry-decision
    // check, which only decides whether to retry, not the final verdict.
    const finalSelfReportIdx = laneSource.indexOf('GREEN agent call returned no result after retries')
    expect(exitCheckIdx).toBeGreaterThan(-1)
    expect(finalSelfReportIdx).toBeGreaterThan(-1)
    // The deterministic check must run BEFORE the final self-report trust,
    // so a hallucinated tests_pass: true cannot short-circuit past it.
    expect(exitCheckIdx).toBeLessThan(finalSelfReportIdx)
  })

  it('reports the failure with a distinct green_verify_failed error', () => {
    expect(laneSource).toContain('green_verify_failed:')
  })

  it('does not gate the independent GREEN test-verify step behind deterministicChecks()', () => {
    // The verify step must run whenever GREEN ran — it is not optional.
    const verifyCallIdx = laneSource.search(/postGreenSteps\(\{[\s\S]{0,200}verifyTestCmd:\s*scopedTestCmd/)
    expect(verifyCallIdx).toBeGreaterThan(-1)
    const precedingSlice = laneSource.slice(Math.max(0, verifyCallIdx - 300), verifyCallIdx)
    expect(precedingSlice).not.toMatch(/if \(deterministic\)/)
  })
})

// ---------------------------------------------------------------------------
// REFACTOR is verified independently too. runRefactor trusted the agent's
// self-reported tests_pass; a hallucinated "true" merged a refactor that
// broke the suite, and a self-reported "false" was followed by returning
// verified:true anyway. The script must re-run the suite itself after
// REFACTOR, revert the refactor commit deterministically when the
// independent run is red, and fail the lane if the tree is still red.
// ---------------------------------------------------------------------------

describe('REFACTOR is independently verified (deterministic)', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  // runRefactor is defined after runLane; slice from its start to the end of the file.
  const fn = laneSource.slice(laneSource.indexOf('async function runRefactor'))

  it('runs an independent test-verify step after the REFACTOR agent and reads the real exit code', () => {
    expect(fn).toMatch(/refactor-verify/)
    expect(fn).toMatch(/testExitCode\(/)
  })

  it('reverts the refactor commit deterministically when the independent run is red, and fails the lane if still red', () => {
    expect(fn).toMatch(/reset --hard HEAD~1|revert --no-edit HEAD/)
    expect(fn).toMatch(/refactor_verify_failed/)
  })

  it('never returns verified:true on a red independent run without reverting', () => {
    // The old shape: `if (!refactor.tests_pass) { ... return { verified: true } }` with no
    // independent exit consulted. The decision must be keyed on the independent exit.
    expect(fn).toMatch(/refactorVerifyExit\s*(!==|===)\s*0/)
  })
})
