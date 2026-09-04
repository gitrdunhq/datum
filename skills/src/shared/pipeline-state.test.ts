// Tests for pipeline-state.ts's staleness guard, added while dogfooding
// datum-go end-to-end (reported by a peer session running against a
// different repo): leftover .datum/pipeline-state.json from an unrelated,
// no-longer-checked-out epic was silently trusted by datum-go's auto-resume
// path, which set startFrom=act based on that stale state's completedPhases
// — skipping Refine/Plan/Properties for what was actually a brand new epic,
// so no TICKET.md/SPEC.md/lane-plan.json ever got written and Act crashed
// looking for a lane-plan.json that was never going to exist.

import { describe, it, expect } from 'vitest'
import { isStaleState, type PipelineState } from './pipeline-state'

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
