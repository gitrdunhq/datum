// batch.ts — collapse a run of consecutive command-runner agent() calls into
// ONE datum-cli call (#368 item C).
//
// The sandbox has no non-LLM shell primitive: every shell-out costs a fresh
// subagent with ~30K tokens of context. Where a lane issues several commands
// with no LLM judgement between them, build a single bash script that runs
// them in order, records each step's exit code / stdout / stderr, stops at
// the first non-zero exit of a non-tolerant step, and prints ONE JSON array.
// The agent runs the script in one Bash invocation and returns its stdout;
// the workflow script — not the LLM — evaluates the results.
//
// Pure functions, no sandbox globals. tested-by: skills/src/shared/batch.test.ts

import { parseAgentJson } from './utils'

export interface BatchStep {
  /** Unique step id, `[a-z][a-z0-9-]*`. Used to look the result up. */
  name: string
  /** Shell text, run inside a `{ ... }` group in the current shell (variables
   *  assigned in one step are visible to later steps). May span lines and
   *  contain heredocs. Must not call `exit`. */
  command: string
  /** A non-zero exit does not stop the batch (grep with no match, checks
   *  whose exit code is the answer, ...). Default: stop on first failure. */
  tolerant?: boolean
}

export interface BatchStepResult {
  name: string
  exit_code: number
  stdout: string
  stderr: string
}

export interface BatchResult {
  steps: BatchStepResult[]
  /** The non-tolerant step whose non-zero exit stopped the batch, if any. */
  failed: BatchStepResult | null
  /** True when the agent returned nothing parseable — the caller should treat
   *  this the way it treats a null agent() result today. */
  missing: boolean
}

const NAME_RE = /^[a-z][a-z0-9-]*$/

export function validateBatchSteps(steps: BatchStep[]): void {
  if (steps.length === 0) throw new Error('batch: no steps')
  const seen = new Set<string>()
  for (const s of steps) {
    if (!NAME_RE.test(s.name)) throw new Error(`batch: invalid step name "${s.name}"`)
    if (seen.has(s.name)) throw new Error(`batch: duplicate step name "${s.name}"`)
    seen.add(s.name)
    if (!s.command || !s.command.trim()) throw new Error(`batch: step "${s.name}" has an empty command`)
  }
}

/** The bash script that runs every step and prints one JSON array. */
export function batchScript(steps: BatchStep[]): string {
  validateBatchSteps(steps)
  const lines: string[] = [
    '__bo=$(mktemp); __be=$(mktemp); __r=\'[]\'',
    '__rec() { __r=$(printf \'%s\' "$__r" | jq -c --arg n "$1" --argjson c "$2" --rawfile o "$__bo" --rawfile e "$__be" \'. + [{name:$n, exit_code:$c, stdout:$o, stderr:$e}]\'); }',
    '__end() { printf \'%s\\n\' "$__r"; rm -f "$__bo" "$__be"; }',
  ]
  steps.forEach((s, i) => {
    lines.push(`# step ${i + 1}/${steps.length}: ${s.name}${s.tolerant ? ' (tolerant)' : ''}`)
    lines.push('{')
    lines.push(s.command.replace(/\n+$/, ''))
    lines.push(`} >"$__bo" 2>"$__be"; __c=$?`)
    lines.push(`__rec '${s.name}' "$__c"`)
    if (!s.tolerant) lines.push('if [ "$__c" -ne 0 ]; then __end; exit 0; fi')
  })
  lines.push('__end')
  return lines.join('\n') + '\n'
}

/** Prompt for the datum-cli agent: run the script once, return its stdout. */
export function batchCommandPrompt(steps: BatchStep[]): string {
  return (
    'Run exactly this script with the Bash tool in ONE invocation and return only its stdout, nothing else. ' +
    'Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, ' +
    'do not message anyone, do not summarise or explain — this prompt is the whole task. ' +
    'The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); ' +
    'a non-zero exit_code is data to return, not a problem to solve.\n\n' +
    batchScript(steps)
  )
}

function asStepResult(x: unknown): BatchStepResult | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  if (typeof o.name !== 'string') return null
  const code = typeof o.exit_code === 'number' ? o.exit_code : parseInt(String(o.exit_code ?? ''), 10)
  return {
    name: o.name,
    exit_code: Number.isFinite(code) ? code : 1,
    stdout: typeof o.stdout === 'string' ? o.stdout : '',
    stderr: typeof o.stderr === 'string' ? o.stderr : '',
  }
}

/** Parse what the agent returned (string or already-parsed array). */
export function parseBatchResult(raw: unknown, steps: BatchStep[]): BatchResult {
  const arr: unknown = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? parseAgentJson<unknown>(raw, null)
      : null
  if (!Array.isArray(arr)) return { steps: [], failed: null, missing: true }
  const results = arr.map(asStepResult).filter((r): r is BatchStepResult => r !== null)
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name))
  const failed = results.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null
  return { steps: results, failed, missing: false }
}

export function stepResult(r: BatchResult, name: string): BatchStepResult | null {
  return r.steps.find((s) => s.name === name) ?? null
}

/** stdout of a step, or null when the step did not run / was not reported. */
export function stepStdout(r: BatchResult, name: string): string | null {
  const s = stepResult(r, name)
  return s ? s.stdout : null
}

/** One-line summary of a failed step for log/error messages. */
export function describeFailure(r: BatchResult, label: string): string {
  if (r.missing) return `${label}: batch agent returned no parseable result`
  if (!r.failed) return `${label}: ok`
  const tail = (r.failed.stderr || r.failed.stdout).trim().split('\n').slice(-5).join('\n')
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail ? ` — ${tail}` : ''}`
}
