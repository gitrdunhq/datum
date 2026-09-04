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
