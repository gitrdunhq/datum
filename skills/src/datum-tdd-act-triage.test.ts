// Tests for datum-tdd-act-triage.ts's filed-count/log accuracy.
//
// Bug: the file-issue agent() call is prompted to say "duplicate found" and
// skip creating a new issue when one already exists, but its return value
// was never inspected — `log('[triage] Filed: ...')` and `filed++` ran
// unconditionally after every call, so a duplicate-skipped issue was still
// reported (and counted in __workflowResult.filed) as newly filed.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-tdd-act-triage.ts'), 'utf8')

describe('datum-tdd-act-triage — accurate filed count/log', () => {
  it('captures the file-issue agent() call result instead of discarding it', () => {
    // The call site must assign its result to a variable, not `await agent(...)`
    // as a bare statement.
    expect(src).toMatch(/const \w+\s*=\s*await agent\(\s*\n\s*`unset GITHUB_TOKEN/)
  })

  it('checks the result for a duplicate indicator before counting/logging as filed', () => {
    expect(src.toLowerCase()).toMatch(/duplicate/)
    // The log/increment must be gated behind a check of the captured result,
    // not run unconditionally right after the agent() call.
    expect(src).toMatch(/if\s*\(![\s\S]{0,80}duplicate/i)
  })

  it('does not increment filed or log "Filed" for a duplicate-skipped issue', () => {
    // A duplicate branch must log something distinct from the success path.
    expect(src).toMatch(/\[triage\] (Skipped|Duplicate)/i)
  })
})

// #387/#392 postmortem: the LLM triage prompt re-guessed a category the
// pipeline had already determined deterministically from a machine-readable
// error prefix, and twice filed a confidently wrong issue. classifyLaneError
// must run BEFORE the agent() call, its deterministic result must be threaded
// into the prompt as a given (not a suggestion) and into the filed issue's
// label, dependency failures must never be filed, and the prompt must warn
// against diagnosing lanes from the ROOT checkout.
describe('datum-tdd-act-triage — deterministic pre-classification (#387/#392)', () => {
  it('imports and calls classifyLaneError from the shared triage-classify module', () => {
    expect(src).toMatch(/import\s*\{\s*classifyLaneError/)
    expect(src).toMatch(/from\s+'\.\/shared\/triage-classify'/)
    expect(src).toMatch(/classifyLaneError\(/)
  })

  it('classifies every failure before the LLM triage agent() call runs', () => {
    const classifyIdx = src.indexOf('classifyLaneError(')
    const agentCallIdx = src.indexOf("label: 'triage'")
    expect(classifyIdx).toBeGreaterThan(-1)
    expect(agentCallIdx).toBeGreaterThan(-1)
    expect(classifyIdx).toBeLessThan(agentCallIdx)
  })

  it('skips filing for dependency-classified failures instead of asking the LLM to diagnose them', () => {
    expect(src).toMatch(/dependency/)
    expect(src).toMatch(/triageableFailures|nonDependency/i)
  })

  it('threads the deterministic category into the prompt as a given, not a request to reclassify', () => {
    expect(src.toLowerCase()).toMatch(/categor(y|ies) already determined/)
    expect(src.toLowerCase()).toMatch(/do not reclassify/)
  })

  it('uses the deterministic classifier result — not the model output — for the filed issue label', () => {
    // The label must be built from a `category` variable derived from the
    // classification, not straight from `issue.category`.
    expect(src).toMatch(/const category = \(cls[\s\S]{0,120}\)\s*\n\s*\?\s*CATEGORY_LABEL/)
    expect(src).toMatch(/`datum-bug,\$\{category\}`/)
  })

  it('warns the model never to inspect the ROOT checkout to diagnose a lane (the #387 failure mode)', () => {
    expect(src.toUpperCase()).toMatch(/NEVER INSPECT THE ROOT CHECKOUT/)
    expect(src).toMatch(/#387/)
  })
})

// #417 postmortem: a skeptic-confirmed CONSUMER-repo code bug ("resolveConvert
// recomputes fog-of-war from stale board state" in Shroud Chess) was filed
// into datum's OWN tracker because the filer hardcodes
// `gh issue create --repo gitrdunhq/datum` for every failure regardless of
// category. Only 'datum'-destined findings (datum's own pipeline/tooling)
// may reach that call; 'consumer'-destined findings (agent_behavior,
// lane_plan, test_quality, unknown — the lane's work or the consumer repo's
// code) must never be filed to datum's tracker, and 'none' (dependency)
// findings are already skipped upstream.
describe('datum-tdd-act-triage — routes findings by destination, never misfiling consumer-code findings to datum (#417)', () => {
  it('imports and calls triageDestination from the shared triage-classify module', () => {
    expect(src).toMatch(/import\s*\{[^}]*triageDestination[^}]*\}/)
    expect(src).toMatch(/from\s+'\.\/shared\/triage-classify'/)
    expect(src).toMatch(/triageDestination\(/)
  })

  it('gates the `gh issue create --repo gitrdunhq/datum` call behind destination checks — only reachable when destination is \'datum\'', () => {
    const createIdx = src.indexOf('gh issue create --repo gitrdunhq/datum')
    expect(createIdx).toBeGreaterThan(-1)
    const before = src.slice(0, createIdx)
    // Non-'datum' destinations must `continue` (early-exit the loop) before
    // reaching the create call — whether phrased as a positive
    // `destination === 'datum'` guard or as early continues for the other
    // two destinations, falling through to the call.
    const guardedPositively = /destination\s*===\s*'datum'/.test(before)
    const earlyExitsForOthers =
      /destination\s*===\s*'consumer'[\s\S]{0,300}continue/.test(before) &&
      /destination\s*===\s*'none'[\s\S]{0,300}continue/.test(before)
    expect(guardedPositively || earlyExitsForOthers).toBe(true)
  })

  it('logs a distinct one-line message per lane for consumer-code findings instead of filing them', () => {
    expect(src).toMatch(/\[triage\] consumer-code finding for/)
    expect(src).toMatch(/not filed to datum'?s? tracker/i)
  })

  it('tracks consumer findings and skipped findings as distinct summary counters alongside filed', () => {
    expect(src).toMatch(/consumer_findings/)
    expect(src).toMatch(/\bskipped\b/)
    expect(src).toMatch(/__workflowResult\s*=\s*\{[^}]*filed[^}]*consumer_findings[^}]*skipped[^}]*\}/s)
  })
})
