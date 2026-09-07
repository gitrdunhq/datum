// task-003: integration_failed is a signal that the INDEPENDENT verify step
// (task-002) found the merged epic's suite red even though every lane's own
// tests passed in isolation — a genuine cross-lane code defect, not a
// pipeline/tooling failure and not agent misbehaviour. This file pins the
// new `code_defect` category classifyLaneError must add for the exact
// byte-shape task-002 produces: `integration_failed: covered <ids>;
// invariants <ids> (independent verify exit=<n>)`.

import { describe, it, expect } from 'vitest'
import { classifyLaneError, triageDestination, type TriageClassifyCategory } from './triage-classify'

const SPEC_AC3_1_ERROR =
  'integration_failed: covered task-002, task-003; invariants INV-01, INV-03 (independent verify exit=1)'

describe('classifyLaneError — integration_failed is code_defect (task-003)', () => {
  it('classifies the exact task-002 integration_failed shape as code_defect, deterministically, and distinct from agent_behavior and every other pre-existing category', () => {
    const result = classifyLaneError(SPEC_AC3_1_ERROR, 'VALIDATE')

    const preExisting: TriageClassifyCategory[] = [
      'infrastructure',
      'workflow_bug',
      'lane_plan',
      'agent_behavior',
      'test_quality',
      'dependency',
      'unknown',
    ]

    expect(result.category).toBe('code_defect')
    expect(result.category).not.toBe('agent_behavior')
    expect(preExisting).not.toContain(result.category)
    expect(result.confidence).toBe('deterministic')
  })

  it("extracts both covered task ids into `reason` via a `covered ([^;]+)` match, not a hardcoded string", () => {
    const result = classifyLaneError(SPEC_AC3_1_ERROR, 'VALIDATE')

    expect(result.reason).toContain('task-002')
    expect(result.reason).toContain('task-003')
  })

  it('a single covered id still yields a reason containing that one id', () => {
    const result = classifyLaneError(
      'integration_failed: covered task-007; invariants INV-02 (independent verify exit=1)',
      'VALIDATE',
    )

    expect(result.category).toBe('code_defect')
    expect(result.confidence).toBe('deterministic')
    expect(result.reason).toContain('task-007')
  })

  it('an integration_failed error with no `covered ` segment still classifies as code_defect without throwing', () => {
    expect(() => classifyLaneError('integration_failed: exit=1', 'VALIDATE')).not.toThrow()

    const result = classifyLaneError('integration_failed: exit=1', 'VALIDATE')
    expect(result.category).toBe('code_defect')
    expect(result.confidence).toBe('deterministic')
  })

  it('routes code_defect findings to consumer, never to datum\'s own tracker (a cross-lane code bug, not datum tooling)', () => {
    const result = classifyLaneError(SPEC_AC3_1_ERROR, 'VALIDATE')
    expect(triageDestination(result, SPEC_AC3_1_ERROR)).toBe('consumer')
  })

  it('every pre-existing PREFIX_RULES prefix still classifies exactly as before the new rule was inserted', () => {
    expect(classifyLaneError('lane_intake_failed: could not read intake batch result', 'RED').category).toBe('infrastructure')
    expect(classifyLaneError('green_verify_unavailable: post-green-verify: runner_empty_result', 'GREEN').category).toBe('infrastructure')
    expect(classifyLaneError('count_gate_failed: test-count-gate produced no JSON (exit 1)', 'RED').category).toBe('infrastructure')
    expect(classifyLaneError('refactor_failed: real failure_reason reported', 'REFACTOR').category).toBe('agent_behavior')
    expect(classifyLaneError('placeholder_assertions: 3: expect(true).toBe(false)', 'RED').category).toBe('agent_behavior')
    expect(classifyLaneError('green_blindness_violation: GREEN agent read RED test file contents', 'GREEN').category).toBe('agent_behavior')
  })
})
