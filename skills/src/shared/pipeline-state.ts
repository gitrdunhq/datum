/**
 * pipeline-state.ts — Deterministic phase completion tracking.
 *
 * Writes .datum/pipeline-state.json after each phase. On resume,
 * reads it to skip completed phases — zero LLM calls needed.
 */

import type { Phase } from './models'
import { stepResult, describeFailure, type BatchResult, type BatchStep } from './batch'

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

// ── Phase record: `datum pipeline-state-save` as a batch step ──
//
// The CLI verifies the phase against git/filesystem evidence and refuses
// (exit 1, {"verified": false, "reason"}) when it finds none; on success it
// prints the state it wrote. datum-go used to ask an LLM runner to "Run:"
// the command and regex-test whatever it typed back for `"verified": false`
// — a runner that returned nothing (turn cap), paraphrased the refusal, or
// never ran the command was believed, and the phase was recorded in memory
// with nothing on disk. Here the exit code and the JSON come from the step.

export interface PipelineStateSaveOpts {
  phase: Phase
  runId: string
  route: string
  /** Only consulted for the validate phase (--tests-pass / --tests-fail). */
  testsPass?: boolean
}

const q = (s: string): string => `"${s.replace(/(["\\`$])/g, '\\$1')}"`

export function pipelineStateSaveSteps(o: PipelineStateSaveOpts): BatchStep[] {
  const testsFlag = o.phase === 'validate' ? (o.testsPass ? ' --tests-pass' : ' --tests-fail') : ''
  return [{
    name: 'save',
    command: `datum pipeline-state-save --phase ${q(o.phase)} --run-id ${q(o.runId)} --route ${q(o.route)}${testsFlag}`,
    tolerant: true,
  }]
}

export interface PipelineStateSaveResult {
  /** The CLI exited 0 and the state it printed lists `phase` as completed. */
  recorded: boolean
  /** The CLI refused on evidence grounds (exit 1 + verified:false). */
  refused: boolean
  /** '' when recorded; otherwise a named reason (pipeline_state_save_refused / _unverified). */
  reason: string
}

export function pipelineStateSaveFromSteps(result: BatchResult, phase: Phase): PipelineStateSaveResult {
  const unverified = (why: string): PipelineStateSaveResult => ({ recorded: false, refused: false, reason: `pipeline_state_save_unverified: ${why}` })
  if (result.missing) return unverified(describeFailure(result, 'save'))
  const step = stepResult(result, 'save')
  if (!step) return unverified('save step did not run')
  let json: Record<string, unknown> | null = null
  try {
    const text = (step.stdout || '').trim()
    const start = text.indexOf('{')
    json = start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) : null
  } catch {
    json = null
  }
  if (json && json.verified === false) {
    return { recorded: false, refused: true, reason: `pipeline_state_save_refused: ${typeof json.reason === 'string' ? json.reason : 'no reason given'}` }
  }
  if (step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout || '').trim().split('\n').slice(-3).join(' | ')
    return unverified(`datum pipeline-state-save exited ${step.exit_code}${tail ? ` — ${tail}` : ''}`)
  }
  const completed = json && Array.isArray(json.completedPhases) ? (json.completedPhases as unknown[]) : null
  if (!completed || !completed.includes(phase)) {
    return unverified(`exit 0 but the printed state does not list "${phase}" as completed`)
  }
  return { recorded: true, refused: false, reason: '' }
}

export function detectStartFrom(state: PipelineState | null): Phase | null {
  if (!state || !state.completedPhases?.length) return null
  const ORDER: Phase[] = ['refine', 'plan', 'properties', 'act', 'validate', 'review', 'closeout']
  const lastCompleted = state.completedPhases[state.completedPhases.length - 1]
  const idx = ORDER.indexOf(lastCompleted)
  if (idx >= 0 && idx < ORDER.length - 1) return ORDER[idx + 1]
  return null
}
