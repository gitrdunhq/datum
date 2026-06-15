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

export function detectStartFrom(state: PipelineState | null): Phase | null {
  if (!state || !state.completedPhases?.length) return null
  const ORDER: Phase[] = ['refine', 'plan', 'properties', 'act', 'validate', 'review', 'closeout']
  const lastCompleted = state.completedPhases[state.completedPhases.length - 1]
  const idx = ORDER.indexOf(lastCompleted)
  if (idx >= 0 && idx < ORDER.length - 1) return ORDER[idx + 1]
  return null
}
