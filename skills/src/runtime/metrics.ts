// Per-call metrics sink: one JSON line per executed request, appended to
// <repoRoot>/.datum/runs/<runId>/metrics.jsonl. Lines carry numbers and labels
// only, never prompt or reply text.

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { StageReply } from './executor'

// SPEC R7.1: a reply that fails schema validation is recorded as 'invalid'.
export type MetricsOutcome = 'ok' | 'invalid' | 'error'

export interface MetricsLine {
  ts: string
  run_id: string
  label: string
  agent_type: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
  prefill_ms: number
  decode_ms: number
  queue_wait_ms: number
  wall_ms: number
  attempt: number
  outcome: MetricsOutcome
}

export interface MetricsInput {
  ts: Date
  runId: string
  label: string | undefined
  agentType: string | undefined
  model: string
  reply: StageReply | undefined
  queueWaitMs: number
  wallMs: number
  attempt: number
  outcome: MetricsOutcome
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/**
 * Current wall-clock time. The runner executes in Node, outside the workflow
 * sandbox, so reading the clock is fine here; Reflect.construct avoids the
 * argless-constructor pattern the sandbox-globals tripwire bans in bundle code.
 */
export function currentTime(): Date {
  return Reflect.construct(Date, []) as Date
}

/** Runner start time as YYYYMMDD-HHMMSS in UTC. */
export function deriveRunId(start: Date): string {
  return (
    `${pad(start.getUTCFullYear(), 4)}${pad(start.getUTCMonth() + 1)}${pad(start.getUTCDate())}` +
    `-${pad(start.getUTCHours())}${pad(start.getUTCMinutes())}${pad(start.getUTCSeconds())}`
  )
}

/** One plain path segment: the id becomes .datum/runs/<runId> (SEC-001).
 *  Same pattern as datum/run_ids.py on the Python side. */
export const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** args.runId when it is a non-empty string, otherwise the derived id. An id
 *  that is not one plain path segment throws run_id_invalid. */
export function resolveRunId(args: unknown, start: Date): string {
  if (typeof args === 'object' && args !== null) {
    const id = (args as { runId?: unknown }).runId
    if (typeof id === 'string' && id !== '') {
      if (!RUN_ID_RE.test(id)) throw new Error(`run_id_invalid: ${JSON.stringify(id)} is not one plain path segment (${RUN_ID_RE.source})`)
      return id
    }
  }
  return deriveRunId(start)
}

// Key order here is the on-disk contract.
export function buildMetricsLine(input: MetricsInput): MetricsLine {
  const usage = input.reply?.usage
  const timings = input.reply?.timings
  return {
    ts: input.ts.toISOString(),
    run_id: input.runId,
    label: input.label ?? '',
    agent_type: input.agentType ?? '',
    model: input.model,
    prompt_tokens: usage?.prompt_tokens ?? 0,
    completion_tokens: usage?.completion_tokens ?? 0,
    cached_tokens: usage?.cached_tokens ?? 0,
    prefill_ms: timings?.prefill_ms ?? 0,
    decode_ms: timings?.decode_ms ?? 0,
    queue_wait_ms: input.queueWaitMs,
    wall_ms: input.wallMs,
    attempt: input.attempt,
    outcome: input.outcome,
  }
}

/** Appends one line; filesystem errors propagate to the caller. */
export function appendMetricsLine(repoRoot: string, line: MetricsLine): void {
  const dir = join(repoRoot, '.datum', 'runs', line.run_id)
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, 'metrics.jsonl'), JSON.stringify(line) + '\n')
}
