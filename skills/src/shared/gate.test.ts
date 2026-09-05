// Deterministic phase gate. `datum gate <phase>` prints {passed, message,
// hard_stop?, needs_human?} and exits 0/1/2. Four phase scripts (refine, plan,
// properties, validate) asked an LLM agent to run it and RETURN the JSON, then
// trusted `gate?.passed` from that relay. The exit code is the verdict; the
// script must read it from a datum-cli batch step, not from a model's echo.

import { describe, it, expect } from 'vitest'
import { gateSteps, parseGateResult } from './gate'
import type { BatchResult } from './batch'

function batch(exit: number, stdout: string, missing = false): BatchResult {
  return { missing, failed: null, steps: [{ name: 'gate', exit_code: exit, stdout, stderr: '' }] }
}

describe('gateSteps', () => {
  it('runs exactly `datum gate <phase>` with the approve flag when given, tolerant', () => {
    const steps = gateSteps('plan', ' --approve')
    expect(steps).toHaveLength(1)
    expect(steps[0].name).toBe('gate')
    expect(steps[0].command).toBe('datum gate plan --approve')
    expect(steps[0].tolerant).toBe(true)
    expect(gateSteps('refine', '')[0].command).toBe('datum gate refine')
  })
})

describe('parseGateResult', () => {
  it('passes only when the CLI exited 0 AND printed passed:true', () => {
    const r = parseGateResult(batch(0, '{"passed": true, "message": "Plan gate passed"}'))
    expect(r.passed).toBe(true)
    expect(r.message).toBe('Plan gate passed')
    expect(r.exitCode).toBe(0)
  })

  it('does not pass when the JSON says passed:true but the process exited non-zero', () => {
    const r = parseGateResult(batch(1, '{"passed": true}'))
    expect(r.passed).toBe(false)
  })

  it('surfaces a human-approval hold distinctly from a failure', () => {
    const r = parseGateResult(batch(1, '{"passed": false, "needs_human": true, "message": "Re-run with --approve"}'))
    expect(r.passed).toBe(false)
    expect(r.needsHuman).toBe(true)
    expect(r.hardStop).toBe(false)
  })

  it('surfaces a hard stop (exit 2)', () => {
    const r = parseGateResult(batch(2, '{"passed": false, "hard_stop": true, "message": "schema failed"}'))
    expect(r.hardStop).toBe(true)
    expect(r.message).toBe('schema failed')
  })

  it('reports gate_run_failed when the step produced no JSON or did not run', () => {
    const r1 = parseGateResult(batch(127, 'bash: datum: command not found'))
    expect(r1.passed).toBe(false)
    expect(r1.message).toMatch(/gate_run_failed/)
    expect(r1.message).toMatch(/127/)
    const r2 = parseGateResult({ missing: true, failed: null, steps: [] })
    expect(r2.passed).toBe(false)
    expect(r2.message).toMatch(/gate_run_failed/)
  })
})
