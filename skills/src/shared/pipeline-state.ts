/**
 * pipeline-state.ts — Deterministic phase completion tracking.
 *
 * Writes .datum/pipeline-state.json after each phase. On resume,
 * reads it to skip completed phases — zero LLM calls needed.
 */

import type { Phase } from './models'

export interface PipelineState {
  branch: string
  runId: string
  route: string
  completedPhases: Phase[]
  currentPhase: Phase | null
  lastUpdated: string
}

export function parseState(raw: string | null): PipelineState | null {
  if (!raw) return null
  try {
    return JSON.parse(raw.replace(/```[a-z]*\n?/g, '').trim()) as PipelineState
  } catch {
    return null
  }
}

export function serializeState(state: PipelineState): string {
  return JSON.stringify(state, null, 2)
}

/**
 * True when `state` belongs to a branch other than the one currently
 * checked out. `.datum/pipeline-state.json` is a single global file, not
 * scoped per branch — leftover state from a prior, unrelated epic must never
 * be trusted to skip phases for a different one just because it happens to
 * still be on disk (#524 dogfooding: this silently sent a fresh epic
 * straight to Act with no SPEC/lane-plan ever written).
 *
 * Deliberately conservative: an unknown current branch (empty string) never
 * counts as stale — the caller should only call this once it actually knows
 * the checked-out branch, not treat "couldn't tell" as "definitely stale".
 */
export function isStaleState(state: PipelineState | null, currentBranch: string): boolean {
  if (!state || !currentBranch) return false
  return state.branch !== currentBranch
}

export function detectStartFrom(state: PipelineState | null): Phase | null {
  if (!state || !state.completedPhases?.length) return null
  const ORDER: Phase[] = ['refine', 'plan', 'properties', 'act', 'validate', 'review', 'closeout']
  const lastCompleted = state.completedPhases[state.completedPhases.length - 1]
  const idx = ORDER.indexOf(lastCompleted)
  if (idx >= 0 && idx < ORDER.length - 1) return ORDER[idx + 1]
  return null
}
