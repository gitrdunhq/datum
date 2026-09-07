// Tests for pipeline-state.ts's staleness guard, added while dogfooding
// datum-go end-to-end (reported by a peer session running against a
// different repo): leftover .datum/pipeline-state.json from an unrelated,
// no-longer-checked-out epic was silently trusted by datum-go's auto-resume
// path, which set startFrom=act based on that stale state's completedPhases
// — skipping Refine/Plan/Properties for what was actually a brand new epic,
// so no TICKET.md/SPEC.md/lane-plan.json ever got written and Act crashed
// looking for a lane-plan.json that was never going to exist.

import { describe, it, expect } from 'vitest'
import { isStaleState, pipelineStateSaveSteps, pipelineStateSaveFromSteps, type PipelineState } from './pipeline-state'
import type { BatchResult } from './batch'

// ---------------------------------------------------------------------------
// `datum pipeline-state-save` refuses (exit 1, {"verified": false, reason})
// when it finds no evidence the phase completed. datum-go used to ask an LLM
// runner to "Run: datum pipeline-state-save ..." and regex-test whatever it
// typed back for `"verified": false` — a runner that returned nothing (turn
// cap), paraphrased the refusal, or never ran the command was believed, and
// the phase was recorded in memory with nothing on disk. The exit code and
// the JSON must come from a batch step.
// ---------------------------------------------------------------------------

function saveBatch(exit: number, stdout: string, missing = false): BatchResult {
  return { missing, failed: null, steps: [{ name: 'save', exit_code: exit, stdout, stderr: '' }] }
}

describe('pipelineStateSaveSteps', () => {
  it('is one tolerant step running exactly datum pipeline-state-save with phase, run id and route', () => {
    const steps = pipelineStateSaveSteps({ phase: 'plan', runId: '20260905-101010', route: 'feature' })
    expect(steps).toHaveLength(1)
    expect(steps[0].name).toBe('save')
    expect(steps[0].tolerant).toBe(true)
    expect(steps[0].command).toBe('datum pipeline-state-save --phase "plan" --run-id "20260905-101010" --route "feature"')
  })

  it('adds --tests-pass / --tests-fail only for the validate phase', () => {
    expect(pipelineStateSaveSteps({ phase: 'validate', runId: 'r', route: 'feature', testsPass: true })[0].command).toMatch(/ --tests-pass$/)
    expect(pipelineStateSaveSteps({ phase: 'validate', runId: 'r', route: 'feature', testsPass: false })[0].command).toMatch(/ --tests-fail$/)
    expect(pipelineStateSaveSteps({ phase: 'act', runId: 'r', route: 'feature', testsPass: true })[0].command).not.toMatch(/--tests-/)
  })
})

describe('pipelineStateSaveFromSteps', () => {
  it('records only when the CLI exited 0 and the printed state lists the phase as completed', () => {
    const r = pipelineStateSaveFromSteps(saveBatch(0, '{"branch": "b", "runId": "r", "route": "feature", "completedPhases": ["refine", "plan"], "currentPhase": null}'), 'plan')
    expect(r).toEqual({ recorded: true, refused: false, reason: '' })
  })

  it('a refusal (exit 1 + verified:false) is refused with the CLI reason, not recorded', () => {
    const r = pipelineStateSaveFromSteps(saveBatch(1, '{"verified": false, "phase": "act", "reason": "no lane merge commits found for run r"}'), 'act')
    expect(r.recorded).toBe(false)
    expect(r.refused).toBe(true)
    expect(r.reason).toBe('pipeline_state_save_refused: no lane merge commits found for run r')
  })

  it('a batch that returned nothing is a named unverified outcome, not a recorded phase', () => {
    const r = pipelineStateSaveFromSteps(saveBatch(0, '', true), 'plan')
    expect(r.recorded).toBe(false)
    expect(r.refused).toBe(false)
    expect(r.reason).toMatch(/^pipeline_state_save_unverified: /)
  })

  it('exit 0 whose stdout does not list the phase is unverified — the exit code alone is not the evidence', () => {
    const r = pipelineStateSaveFromSteps(saveBatch(0, '{"branch": "b", "completedPhases": ["refine"]}'), 'plan')
    expect(r.recorded).toBe(false)
    expect(r.reason).toMatch(/^pipeline_state_save_unverified: .*plan/)
  })

  it('a crash (non-zero exit without a verified:false JSON) is unverified with the stderr tail', () => {
    const r = pipelineStateSaveFromSteps({ missing: false, failed: null, steps: [{ name: 'save', exit_code: 2, stdout: '', stderr: 'Traceback\nKeyError: completedPhases' }] }, 'plan')
    expect(r.recorded).toBe(false)
    expect(r.refused).toBe(false)
    expect(r.reason).toMatch(/^pipeline_state_save_unverified: .*KeyError/)
  })
})

function makeState(overrides: Partial<PipelineState> = {}): PipelineState {
  return {
    branch: 'datum/some-other-epic',
    runId: '20260101-000000',
    route: 'feature',
    completedPhases: ['refine', 'plan', 'properties'],
    currentPhase: null,
    lastUpdated: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('isStaleState', () => {
  it('is stale when the state\'s branch does not match the currently checked-out branch', () => {
    const state = makeState({ branch: 'datum/wire-deterministic-scanner-pr-review' })
    expect(isStaleState(state, 'main')).toBe(true)
  })

  it('is not stale when the branches match', () => {
    const state = makeState({ branch: 'datum/wire-deterministic-scanner-pr-review' })
    expect(isStaleState(state, 'datum/wire-deterministic-scanner-pr-review')).toBe(false)
  })

  it('is not stale when there is no prior state at all', () => {
    expect(isStaleState(null, 'main')).toBe(false)
  })

  it('is not stale when the current branch is unknown (never claim staleness without a real comparison)', () => {
    const state = makeState()
    expect(isStaleState(state, '')).toBe(false)
  })
})
