// gate.ts — deterministic phase gate (#368 follow-up).
//
// `datum gate <phase> [--approve]` (datum/gate.py) prints one JSON object
// {passed, message, hard_stop?, needs_human?} and exits 0 (passed), 1
// (failed / needs human) or 2 (hard stop). Refine, Plan, Properties and
// Validate used to ask an LLM agent to run it and RETURN the JSON, then
// trusted `gate?.passed` from that echo. The verdict is the exit code, read
// from a datum-cli batch step — a model never decides whether a gate passed.
// tested-by: skills/src/shared/gate.test.ts

import type { BatchStep, BatchResult } from './batch'
import { stepResult, describeFailure } from './batch'

export interface GateVerdict {
  passed: boolean
  needsHuman: boolean
  hardStop: boolean
  message: string
  exitCode: number | null
}

/** The single tolerant step: `datum gate <phase><flags>` (flags already include a leading space, e.g. ' --approve'). */
export function gateSteps(phase: string, flags: string): BatchStep[] {
  return [{ name: 'gate', command: `datum gate ${phase}${flags}`, tolerant: true }]
}

export function parseGateResult(result: BatchResult): GateVerdict {
  const step = result.missing ? null : stepResult(result, 'gate')
  if (!step) {
    return {
      passed: false, needsHuman: false, hardStop: false, exitCode: null,
      message: `gate_run_failed: ${describeFailure(result, 'gate')}`,
    }
  }
  let json: { passed?: unknown; message?: unknown; hard_stop?: unknown; needs_human?: unknown } | null = null
  try {
    const text = step.stdout.trim()
    const start = text.indexOf('{')
    json = start >= 0 ? JSON.parse(text.slice(start, text.lastIndexOf('}') + 1)) : null
  } catch {
    json = null
  }
  if (!json || typeof json !== 'object') {
    const tail = (step.stderr || step.stdout).trim().split('\n').slice(-3).join(' | ')
    return {
      passed: false, needsHuman: false, hardStop: step.exit_code === 2, exitCode: step.exit_code,
      message: `gate_run_failed: datum gate exited ${step.exit_code} without JSON${tail ? ` — ${tail}` : ''}`,
    }
  }
  return {
    passed: step.exit_code === 0 && json.passed === true,
    needsHuman: json.needs_human === true,
    hardStop: step.exit_code === 2 || json.hard_stop === true,
    exitCode: step.exit_code,
    message: typeof json.message === 'string' ? json.message : '',
  }
}
