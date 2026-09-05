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
import { classifyLaneError } from './shared/triage-classify'

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
  const stagePrompts = ['red.md', 'red-retry.md', 'green.md', 'green-retry.md', 'refactor.md']

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

  it('reads the diff from a batch step (exit code + stdout), never from an LLM-typed files_changed JSON', () => {
    // The legacy (hooks-not-installed) check asked a runner to run
    // `git diff --name-only HEAD~1 HEAD` and RETURN {"files_changed": [...]}.
    // A runner that dropped a path from that list hid a real violation with
    // no trace. Same step builder as the deterministic post-RED/post-GREEN
    // batches, same evaluator (ownershipFromStdout), so both modes agree.
    const body = ownershipFnBody()
    expect(body).toMatch(/ownershipCheckSteps\(wt\)/)
    expect(body).toMatch(/batchCommandPrompt\(/)
    expect(body).toMatch(/ownershipFromStdout\(stepStdout\(/)
    expect(body).not.toMatch(/files_changed/)
  })

  it('an unparseable batch (missing result) is a check failure carrying describeFailure detail, not a clean pass', () => {
    const body = ownershipFnBody()
    expect(body).toMatch(/result\.missing/)
    expect(body).toMatch(/ownership_check_failed: [^`]*\$\{describeFailure\(result, 'ownership-check'\)\}/)
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

describe('in-batch dep merge is a batch with exit codes, not an LLM echo judged by regex (#296)', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const start = laneSource.indexOf('const depBranches: string[]')
  const block = laneSource.slice(start, laneSource.indexOf('merged in-batch dep branches', start))

  it('builds depMergeSteps(wt, depBranches) and reads the verdict with depMergeFromSteps', () => {
    expect(start).toBeGreaterThan(-1)
    expect(block).toMatch(/depMergeSteps\(wt, depBranches\)/)
    expect(block).toMatch(/depMergeFromSteps\(parseBatchResult\(/)
    expect(block).not.toMatch(/Run these commands in order/)
    expect(block).not.toMatch(/CONFLICT\|Automatic merge failed/)
  })

  it('a failed dep merge still fails the lane at CRASH with the dep_merge_failed prefix triage already classifies', () => {
    expect(block).toMatch(/if \(!depMerge\.ok\) \{/)
    expect(block).toMatch(/error: depMerge\.error/)
    expect(block).toMatch(/stage: 'CRASH'/)
  })
})

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

// wf_b1c88e09-036 BUG F: a GREEN agent hit its 30-turn cap mid-edit (7 Edits
// + ~20 Reads on a 555-line file) and returned nothing; the opus retry then
// started from the dirty worktree the first attempt left behind, hit the cap
// again, and the lane failed with "unknown". A null stage result must be a
// NAMED failure that says what a null means, and the retry must start from
// the lane's last commit, not from half-applied edits.
describe('GREEN null result — named error and clean-slate retry (BUG F)', () => {
  const laneSrc = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const greenFn = laneSrc.slice(laneSrc.indexOf('async function runLane'), laneSrc.indexOf('async function runSkepticPanel'))

  it('names a null GREEN result green_no_result and mentions the turn cap as a likely cause', () => {
    expect(greenFn).toMatch(/green_no_result/)
    expect(greenFn).toMatch(/maxTurns/)
  })

  it('resets the worktree to HEAD (worktreeResetSteps) before the escalation retry when the first attempt returned nothing', () => {
    expect(laneSrc).toMatch(/from '\.\/shared\/commit-steps'/)
    const resetAt = greenFn.indexOf('worktreeResetSteps(')
    const retryAt = greenFn.indexOf('green-retry:')
    expect(resetAt).toBeGreaterThan(-1)
    expect(retryAt).toBeGreaterThan(-1)
    expect(resetAt).toBeLessThan(retryAt)
  })
})

// Mirrors the GREEN null-result fix (887c6aa, BUG F) for RED: a null
// resilientAgent result is not "unknown" — it means the RED agent returned
// nothing (maxTurns cap in agents/datum-red.md, an API error, or a skip) and
// may have left half-applied test edits in the worktree. The retry must
// start from a reset worktree, and a second null must fail the lane loudly
// with a named reason before any post-RED batch runs.
describe('RED null result — named error and clean-slate retry', () => {
  const laneSrc = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const redFn = laneSrc.slice(laneSrc.indexOf('async function runLane'), laneSrc.indexOf('async function runSkepticPanel'))

  it('names a null RED result red_no_result and mentions the turn cap as a likely cause', () => {
    expect(redFn).toMatch(/red_no_result/)
    expect(redFn).toMatch(/maxTurns/)
  })

  it('resets the worktree to HEAD (worktreeResetSteps) before the RED escalation retry when the first attempt returned nothing', () => {
    expect(laneSrc).toMatch(/from '\.\/shared\/commit-steps'/)
    const resetAt = redFn.indexOf('worktreeResetSteps(')
    const retryAt = redFn.indexOf('red-retry:')
    expect(resetAt).toBeGreaterThan(-1)
    expect(retryAt).toBeGreaterThan(-1)
    expect(resetAt).toBeLessThan(retryAt)
  })

  it('fails the lane with red_no_result (stage RED) if the retry is also null, before any post-RED batch runs', () => {
    const noResultAt = redFn.indexOf('red_no_result')
    const postRedAt = redFn.indexOf('post-red:')
    expect(noResultAt).toBeGreaterThan(-1)
    expect(postRedAt).toBeGreaterThan(-1)
    expect(noResultAt).toBeLessThan(postRedAt)
    expect(redFn).toMatch(/stage:\s*'RED'/)
  })
})

// Mirrors the GREEN null-result fix for REFACTOR: unlike RED/GREEN, REFACTOR
// is optional, so a null result must NOT be conflated with "nothing to
// change" (no half-applied edits survive that path). Reset the worktree,
// name the failure, and confirm independently that the suite is still green
// from the reset tree before treating it as "no refactor applied".
describe('REFACTOR null result — named error, worktree reset, independent re-verify', () => {
  const laneSrc = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const refactorFn = laneSrc.slice(laneSrc.indexOf('async function runRefactor'), laneSrc.indexOf('// ── DAG scheduler'))

  it('names a null REFACTOR result refactor_no_result and mentions the turn cap as a likely cause', () => {
    expect(refactorFn).toMatch(/refactor_no_result/)
    expect(refactorFn).toMatch(/maxTurns/)
  })

  it('resets the worktree to HEAD (worktreeResetSteps) on a null result, before deciding verified', () => {
    expect(laneSrc).toMatch(/from '\.\/shared\/commit-steps'/)
    const resetAt = refactorFn.indexOf('worktreeResetSteps(')
    expect(resetAt).toBeGreaterThan(-1)
  })

  it('does not blindly return verified:true on a null result — it re-verifies the suite independently first', () => {
    // The null-result branch must reach the same test-verify step used by the
    // real REFACTOR path, and must be able to return verified:false when that
    // verify can't confirm a green suite.
    const nullBranch = refactorFn.slice(refactorFn.indexOf('if (!refactor)'), refactorFn.indexOf('if (!refactor.success)'))
    expect(nullBranch).toMatch(/test-verify/)
    expect(nullBranch).toMatch(/verified:\s*false/)
    expect(nullBranch).toMatch(/refactor_no_result/)
  })
})

// elonchesd run wf_949ca712-b07 (#415): the runtime THROWS
// `agent({schema}): subagent completed without calling StructuredOutput`
// when a schema'd agent answers in prose. RED/GREEN/REFACTOR go through
// resilientAgent, which turns that throw into null and the *_no_result
// paths retry from a reset worktree — but reflect and refactor-check called
// agent() directly, so the throw escaped to the lane's outer catch:
// stage=CRASH, no retry, 10 dependent lanes blocked, although RED's commit
// was fine. And a null reflect scored the tests 0/10 and FAILED the lane on
// a fabricated number.
describe('reflect and refactor-check never crash the lane on a prose reply', () => {
  const laneSrc = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const laneFn = laneSrc.slice(laneSrc.indexOf('async function runLane'), laneSrc.indexOf('async function runSkepticPanel'))
  const refactorFn = laneSrc.slice(laneSrc.indexOf('async function runRefactor'), laneSrc.indexOf('// ── DAG scheduler'))

  it('reflect goes through resilientAgent (throw → null, one retry), and a null result is reflect_no_result, not a 0/10 failure', () => {
    const reflectCall = laneFn.slice(laneFn.indexOf('reflectPrompt('), laneFn.indexOf('reflectPrompt(') + 400)
    // witnessedAgent is resilientAgent plus the lane-spec read witness check.
    expect(laneFn).toMatch(/await witnessedAgent\(\s*reflectPrompt\(/)
    expect(laneSrc).toMatch(/async function witnessedAgent<T>\([\s\S]{0,300}await resilientAgent<T>\(prompt, opts\)[\s\S]{0,120}assertStageWitness\(specFile, result, stage\)/)
    expect(reflectCall).toMatch(/maxRetries: 1/)
    expect(laneFn).toMatch(/reflect_no_result/)
    // The score must only be read once a non-null result is established.
    expect(laneFn.indexOf('reflect_no_result')).toBeLessThan(laneFn.indexOf('reflectResult?.score') === -1 ? laneFn.indexOf('reflectResult.score') : laneFn.indexOf('reflectResult?.score'))
  })

  it('refactor-check goes through resilientAgent, and a null result is refactor_check_no_result rather than "nothing to improve"', () => {
    expect(refactorFn).toMatch(/await resilientAgent\(\s*refactorCheckPrompt\(/)
    expect(refactorFn).toMatch(/refactor_check_no_result/)
    expect(refactorFn).not.toMatch(/preCheck\?\.reason \|\| 'nothing to improve'/)
  })

  it('no schema call in the lane runner bypasses resilientAgent or parallel()', () => {
    // Every `agent(` whose opts carry `schema:` must be `resilientAgent(` or
    // sit inside a parallel() thunk (which resolves throws to null).
    const lines = laneSrc.split('\n')
    const offenders: string[] = []
    lines.forEach((line, i) => {
      if (/\bschema: [A-Z_]+/.test(line)) {
        // Walk back to the nearest enclosing call: the first earlier line that
        // opens an agent()/resilientAgent() call or a parallel() block.
        let enclosing = ''
        for (let j = i; j >= Math.max(0, i - 60); j--) {
          // On the schema line itself only a same-line parallel() counts; the
          // call that OWNS the schema opts sits on or above that line.
          const m = lines[j].match(j === i ? /\bparallel/ : /\b(witnessedAgent|resilientAgent|agent)\(|\bparallel/)
          if (m) { enclosing = m[0]; break }
        }
        if (enclosing !== 'resilientAgent(' && enclosing !== 'witnessedAgent(' && enclosing !== 'parallel') offenders.push(`${i + 1}: ${line.trim()} (enclosing: ${enclosing || 'none'})`)
      }
    })
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// #331 follow-up (elonchesd wf_93040d99-e3c -> wf_30d8f723-8d3): the "RED and
// GREEN commits already exist — resuming from REFACTOR" shortcut trusted the
// commit MESSAGES alone. A GREEN retry that itself failed the skeptic panel's
// independent verify (2/3 BROKEN) still left a `green(...): GREEN complete`
// commit on the branch, so a relaunch resumed straight at REFACTOR against a
// suite that was never actually green, and REFACTOR's real failure_reason was
// swallowed behind a bare "refactor failed" string.
//
// The shortcut must now independently re-verify the suite at the lane's
// current HEAD before trusting it, and REFACTOR failures must carry the
// agent's real reason (or the verify exit code) so triage can classify them
// deterministically instead of the LLM re-guessing from "refactor failed".
// ---------------------------------------------------------------------------

describe('lane intake: the REFACTOR-resume shortcut is gated on an independent test-verify (#331)', () => {
  const laneSrc = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const bothCommittedBlock = laneSrc.slice(
    laneSrc.indexOf('if (redAlreadyCommitted && greenAlreadyCommitted)'),
    laneSrc.indexOf('// ── Pre-RED cleanup'),
  )

  it('reads the independent test-verify exit code from the intake-verify batch before resuming at REFACTOR', () => {
    expect(bothCommittedBlock).toMatch(/testExitCode\(stepStdout\(intakeVerify,\s*'test-verify'\)\)/)
  })

  it('passes verifyTestCmd: scopedTestCmd to a laneIntakeSteps call inside the both-committed branch', () => {
    expect(bothCommittedBlock).toMatch(/laneIntakeSteps\(\{[\s\S]{0,300}verifyTestCmd:\s*scopedTestCmd/)
  })

  it('a missing test-verify result (step did not run) is lane_intake_failed, never treated as green', () => {
    const nullBranch = bothCommittedBlock.slice(
      bothCommittedBlock.indexOf('intakeVerifyExit === null'),
      bothCommittedBlock.indexOf('intakeVerifyExit === 0'),
    )
    expect(nullBranch).toMatch(/lane_intake_failed/)
    expect(nullBranch).not.toMatch(/resuming from REFACTOR/)
  })

  it('only resumes at REFACTOR when the independent verify exit is exactly 0', () => {
    expect(bothCommittedBlock).toMatch(/intakeVerifyExit === 0\)\s*\{[\s\S]{0,200}resuming from REFACTOR/)
  })

  it('logs a green_stale message (with the exit code) and resets the worktree to the RED commit sha when the exit is non-zero', () => {
    const staleBranch = bothCommittedBlock.slice(bothCommittedBlock.indexOf('intakeVerifyExit === 0'))
    expect(staleBranch).toMatch(/green_stale:.*independent exit=\$\{intakeVerifyExit\}/)
    expect(staleBranch).toMatch(/parseCommitVerification\(laneHistoryRaw,\s*'',\s*`red\(\$\{taskId\}\)`,\s*'RED'\)/)
    expect(staleBranch).toMatch(/worktreeResetToSteps\(wt,\s*redCommitInfo\.commitSha\)/)
  })

  it('gates the fall-through on worktreeResetToFromSteps (HEAD == RED sha, clean), not on the batch merely parsing', () => {
    const staleBranch = bothCommittedBlock.slice(bothCommittedBlock.indexOf('intakeVerifyExit === 0'))
    expect(staleBranch).toMatch(/const resetToRed = worktreeResetToFromSteps\(resetToRedResult, redCommitInfo\.commitSha\)/)
    expect(staleBranch).toMatch(/if \(!resetToRed\.ok\) \{[\s\S]{0,300}lane_intake_failed: could not reset worktree to RED commit/)
    expect(staleBranch).not.toMatch(/if \(resetToRedResult\.missing\)/)
    expect(staleBranch.indexOf('if (!resetToRed.ok)')).toBeLessThan(staleBranch.indexOf('redAlreadyCommitted = true'))
  })

  it('sets redAlreadyCommitted/greenAlreadyCommitted so the reset lane falls through to the existing RED-only resume path', () => {
    const staleBranch = bothCommittedBlock.slice(bothCommittedBlock.indexOf('intakeVerifyExit === 0'))
    expect(staleBranch).toMatch(/redAlreadyCommitted = true/)
    expect(staleBranch).toMatch(/greenAlreadyCommitted = false/)
  })

  it('feeds the green_stale hint into the first GREEN dispatch as a retry-style failure reason', () => {
    const greenDispatch = laneSrc.slice(
      laneSrc.indexOf('let green: StageResult | null = await witnessedAgent('),
      laneSrc.indexOf('let green: StageResult | null = await witnessedAgent(') + 500,
    )
    expect(greenDispatch).toMatch(/greenStaleHint/)
    expect(greenDispatch).toMatch(/greenRetryPrompt\(/)
    expect(greenDispatch).toMatch(/failureReason:\s*greenStaleHint/)
  })

  it('imports parseCommitVerification and worktreeResetToSteps', () => {
    expect(laneSrc).toMatch(/import \{[^}]*parseCommitVerification[^}]*\} from '\.\/shared\/agents'/)
    expect(laneSrc).toMatch(/import \{[^}]*worktreeResetToSteps[^}]*\} from '\.\/shared\/commit-steps'/)
  })
})

describe('REFACTOR failures surface the real reason, never a bare "refactor failed" (#331)', () => {
  const laneSrc = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const refactorFn = laneSrc.slice(laneSrc.indexOf('async function runRefactor'), laneSrc.indexOf('// ── DAG scheduler'))

  it('runRefactor never returns bare null for a real (non-"nothing to change") REFACTOR failure', () => {
    const successFalseBlock = refactorFn.slice(
      refactorFn.indexOf('if (!refactor.success)'),
      refactorFn.indexOf('if (!refactor.success)') + 900,
    )
    expect(successFalseBlock).not.toMatch(/return null/)
    expect(successFalseBlock).toMatch(/refactor_failed:\s*\$\{refactor\.failure_reason/)
  })

  it('the final REFACTOR call site checks .verified (not just truthiness) and surfaces refResult.error', () => {
    const finalCallSite = laneSrc.slice(
      laneSrc.indexOf('const refResult = await runRefactor('),
      laneSrc.indexOf('const refResult = await runRefactor(') + 700,
    )
    expect(finalCallSite).toMatch(/!refResult \|\| !refResult\.verified/)
    expect(finalCallSite).toMatch(/refResult\?\.error \|\| 'refactor failed'/)
  })

  it('the structural and both-committed fast-paths already surface r.error (still hold post-#331)', () => {
    const structuralBlock = laneSrc.slice(laneSrc.indexOf('if (isStructural) {'), laneSrc.indexOf('if (isStructural) {') + 400)
    expect(structuralBlock).toMatch(/r\?\.error \|\| 'refactor failed'/)
  })
})

// The GREEN-side contract check (#356: is this GREEN failure fixable inside
// allowed_write_files at all?) was a runner told to "Run: datum
// contract-preflight ..." and return the JSON — the same relay the RED side
// already replaced with the scope-contract batch. parseContractPreflight
// treats a non-JSON echo as "skipped", so a runner that summarised the
// output turned a contract_conflict into a blind opus retry.
describe('GREEN contract check runs through the scope-contract batch, not a "Run:" echo', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')

  it('no longer builds a contract-preflight prompt for an LLM runner', () => {
    expect(laneSource).not.toMatch(/contractPreflightPrompt/)
    expect(laneSource).not.toMatch(/contractPreflightCmd/)
    expect(laneSource).not.toMatch(/Run: \$\{contractPreflight/)
  })

  it('the contract-check call is scopeContractSteps with no scope gaps, parsed from the contract-preflight step stdout', () => {
    const idx = laneSource.indexOf("label: `contract-check:${taskId}`")
    expect(idx).toBeGreaterThan(-1)
    const block = laneSource.slice(idx - 600, idx + 400)
    expect(block).toMatch(/scopeContractSteps\(\{ wt, scopeGaps: \[\], contractPreflight: \{ testFiles, implFiles, scopedTestCmd \} \}\)/)
    expect(block).toMatch(/parseContractPreflight\(stepStdout\(/)
    expect(block).toMatch(/'contract-preflight'/)
  })
})

// The lane runner receives the DIGEST (no acceptance criteria). At intake,
// `datum lane-spec-export` writes the full lane to <wt>/.datum/lane-spec.json
// and returns only short fields; every agent that needs the criteria reads
// the file by path and proves it with a read_witness (blob sha prefix).
describe('runLane exports the lane spec to a worktree file at intake', () => {
  const laneSource = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  const start = laneSource.indexOf('async function runLane(')
  const body = laneSource.slice(start)

  it('passes planPath/taskId/outPath/expectHash to laneIntakeSteps and parses the summary with laneSpecFromSteps', () => {
    expect(body).toMatch(/laneSpec: \{ planPath: `\$\{wt\}\/\.datum\/lane-plan\.json`, taskId, outPath: `\$\{wt\}\/\.datum\/lane-spec\.json`, expectHash: digestSpecHash\(lanePlan, taskId\) \}/)
    expect(body).toMatch(/laneSpecFromSteps\(intakeResult, taskId, `\$\{wt\}\/\.datum\/lane-spec\.json`\)/)
    expect(body).not.toMatch(/laneSpecFromSteps\(intakeResult, taskId, digestSpecHash/)
  })

  it('a failed export fails the lane by its named reason before any stage agent runs', () => {
    const fetchIdx = body.indexOf('laneSpecFromSteps(intakeResult')
    const redIdx = body.indexOf("label: `red:${taskId}`")
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(fetchIdx).toBeLessThan(redIdx)
    expect(body).toMatch(/if \(!spec\.ok \|\| !spec\.spec\) \{[\s\S]{0,200}status: 'failed', stage: 'CRASH', error: spec\.error/)
  })

  it('the criteria text never enters the script: no acStr, no acceptance_criteria read, ac_count from the export summary', () => {
    expect(body).not.toMatch(/acStr/)
    expect(body).not.toMatch(/acceptance_criteria/)
    expect(body).not.toMatch(/extractContractSummary/)
    expect(body).toMatch(/const acCount = spec\.spec\.ac_count/)
  })

  it('every stage prompt that needs the criteria gets the deferred spec file, and their results are witness-checked', () => {
    const specFile = 'const specFile = laneSpecContextFile(spec.spec)'
    expect(body).toContain(specFile)
    // RED/GREEN packets, reflect and skeptic all carry the file reference.
    expect(body).toMatch(/buildPacket\(taskId, testFiles, implFiles, lane, wt, laneCfg, 'RED', specFile/)
    expect(body).toMatch(/buildPacket\(taskId, testFiles, implFiles, lane, wt, scopedLaneCfg, 'GREEN', specFile/)
    expect(body).toMatch(/reflectPrompt\(\{ wt, testFiles: testFiles\.join\(', '\), laneSpec: specFile \}\)/)
    expect(body).toMatch(/runSkepticPanel\(taskId, wt, implFiles, testFiles, scopedTestCmd, specFile\)/)
    // The prompt builders carry the file reference so the witness paragraph is part of the prompt.
    expect(body).toMatch(/laneSpec: specFile,?\s*\n\s*\}\s*\n\s*(let|const) red/)
    // No stage call inside runLane goes through bare resilientAgent any more
    // (the first GREEN call picks its prompt with a ternary, so match the
    // call, not the prompt name): the witnessed wrapper throws
    // context_read_unverified on a missing/forged witness.
    const runLaneOnly = body.slice(0, body.indexOf('async function runSkepticPanel'))
    expect(runLaneOnly.match(/await resilientAgent\(/g) || []).toEqual([])
    expect((runLaneOnly.match(/await witnessedAgent\(/g) || []).length).toBe(9)
    expect(laneSource).toMatch(/assertReadWitness\(\[?specFile\]?, /)
  })

  it('a thrown context_read_unverified reaches the outcome as its own message and its own stage, not "Error: ..." at CRASH', () => {
    expect(laneSource).toMatch(/error: e instanceof Error \? e\.message : String\(e\)/)
    expect(laneSource).toMatch(/stage: staged \|\| 'CRASH'/)
    // Every witnessed call names its stage; skeptic lenses are GREEN-stage evidence.
    expect((laneSource.match(/specFile, '(RED|GREEN)',/g) || []).length).toBe(9)
    expect(laneSource).toMatch(/assertStageWitness\(specFile, r, 'GREEN'\)/)
  })
})

describe('triage-classify — refactor_failed is a known deterministic prefix', () => {
  it('classifyLaneError classifies refactor_failed as agent_behavior deterministically', () => {
    const result = classifyLaneError('refactor_failed: suite red after REFACTOR wrote a broken helper', 'REFACTOR')
    expect(result.category).toBe('agent_behavior')
    expect(result.confidence).toBe('deterministic')
  })
})
