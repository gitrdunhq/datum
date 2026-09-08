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
import { gitBlobSha } from './sha1'
import { utf8Encode } from './utf8'

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
  /** The runner's prose reply when it returned text instead of the JSON
   *  array — kept so describeFailure can name a permission refusal. */
  refusal?: string
  /** `batch_script_corrupt: expected <sha>, got <sha>` — the runner did not
   *  run the script it was given (a transcription error); runBatch retries once. */
  corrupt?: string
  /** Any wrapper-level `__script` failure verbatim (`batch_script_corrupt: ...`,
   *  `batch_root_missing: <root>`); nothing in the batch ran. */
  scriptError?: string
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

/**
 * The bash script that runs every step and prints one JSON array.
 *
 * Delivered through a quoted heredoc into a file and hashed with
 * `git hash-object` against the sha computed here before it runs: the
 * runner TRANSCRIBES the script into its Bash call, and a fast model drops
 * a character in a 24-line script with nested quoting (caliper eedom
 * wf_4f739141-c8c: `printf '{"root": "%s"}'` became `"%s'}'`, an unmatched
 * quote, a halted run). A mismatch prints one `__script` step naming
 * batch_script_corrupt instead of running anything; runBatch retries once.
 */
export function batchScript(steps: BatchStep[]): string {
  const inner = innerBatchScript(steps)
  const sha = gitBlobSha(utf8Encode(inner))
  // elonchesd: a runner whose cwd was not the repo root ran a batch whose
  // every relative `.datum/...` path missed. The orchestrator records the
  // root at boot and every batch of the run starts there; a root that no
  // longer exists is one named __script step, and nothing runs.
  const rootGuard = batchRoot
    ? [`cd ${shellQuote(batchRoot)} 2>/dev/null || { printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_root_missing: %s"}]\\n' ${shellQuote(batchRoot)}; exit 0; }`]
    : []
  // The runner's shell may lack the tool prefixes (datum self-hosted
  // wf_c296b6b0-721: no /opt/homebrew/bin, jq not found, the runner invented
  // a `__script` row; caliper's ast-grep fallback had the same cause). The
  // usual prefixes are appended (never prepended: the caller's PATH wins),
  // overridable through DATUM_BATCH_TOOL_PREFIXES, and jq — which every step
  // record depends on — is named when still missing, before anything runs.
  const toolPath = 'export PATH="$PATH:${DATUM_BATCH_TOOL_PREFIXES:-/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin}"'
  const jqGuard = `if ! jq --version >/dev/null 2>&1; then printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_tool_missing: jq is not on the runner PATH (set DATUM_BATCH_TOOL_PREFIXES or install jq)"}]\\n'; exit 0; fi`
  return [
    ...rootGuard,
    toolPath,
    jqGuard,
    '__f=$(mktemp); trap \'rm -f "$__f"\' EXIT',
    `cat > "$__f" <<'${BATCH_EOF}'`,
    inner.replace(/\n$/, ''),
    BATCH_EOF,
    '__h=$(git hash-object "$__f" 2>&1)',
    // `bash "$__f"`, not sourced: the runner's Bash tool was zsh 5.9 on the
    // datum host (2026-09-07) and zsh refused to source the file with exit
    // 126 while bash ran it — every "boot refused the script" halt of the
    // week. The wrapper's cwd and exported PATH reach the child; a prelude
    // variable must be exported to be seen (the tests' `export __root=`).
    `if [ "$__h" != "${sha}" ]; then printf '[{"name":"__script","exit_code":1,"stdout":"","stderr":"batch_script_corrupt: expected %s, got %s"}]\\n' "${sha}" "$__h"; else bash "$__f"; fi`,
  ].join('\n') + '\n'
}

const BATCH_EOF = 'DATUM_BATCH_EOF'

/** Double-quoted for bash: `"`, `\`, `` ` `` and `$` escaped. */
function shellQuote(s: string): string {
  return `"${s.replace(/(["\\`$])/g, '\\$1')}"`
}

// The repo root recorded at boot (`git rev-parse --show-toplevel` in
// bootSteps), one copy per bundle like the cache key: every script sets it
// from its args before its first batchCommandPrompt (agent-types-ordering
// test). Empty means "wherever the runner starts", the pre-guard behaviour.
let batchRoot = ''

export function setBatchRoot(root: string): void {
  batchRoot = typeof root === 'string' ? root.trim() : ''
}

/** The unwrapped step runner (what the heredoc carries). */
export function innerBatchScript(steps: BatchStep[]): string {
  validateBatchSteps(steps)
  for (const s of steps) {
    if (s.command.split('\n').some((l) => l.trim() === BATCH_EOF)) throw new Error(`batch: step "${s.name}" contains the heredoc delimiter ${BATCH_EOF}`)
  }
  const lines: string[] = [
    '__bo=$(mktemp); __be=$(mktemp); __r=\'[]\'',
    // #517: jq's exit is checked. A step jq cannot encode is still recorded —
    // without jq (name and exit code are validated/numeric, so a literal is
    // safe) and named on stderr — instead of vanishing from the array.
    '__rec() { __n=$(printf \'%s\' "$__r" | jq -c --arg n "$1" --argjson c "$2" --rawfile o "$__bo" --rawfile e "$__be" \'. + [{name:$n, exit_code:$c, stdout:$o, stderr:$e}]\') && __r="$__n" || { __sep=","; [ "$__r" = "[]" ] && __sep=""; __r="${__r%]}${__sep}{\\"name\\":\\"$1\\",\\"exit_code\\":$2,\\"stdout\\":\\"\\",\\"stderr\\":\\"batch_rec_failed: jq could not record this step (exit $2; output lost, likely not valid UTF-8)\\"}]"; }; }',
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

// Resume cache key. `Workflow({resumeFromRunId})` replays every agent()
// whose (prompt, opts) is unchanged — including deterministic batches that
// read files the human edited between runs (an answered QUESTIONS.md, a
// fixed SPEC.md) and the gate that judged them. The launcher computes
// `datum config-fingerprint` (config + epic docs + pipeline state) on every
// launch and each script stamps it into every batch prompt via
// setBatchCacheKey, so an edit is a cache miss and an unchanged input still
// hits. Module state, one copy per bundle — every script sets it from args
// before its first batchCommandPrompt (agent-types-ordering.test.ts).
let cacheKey = ''

export function setBatchCacheKey(key: string): void {
  cacheKey = typeof key === 'string' ? key : ''
}

/** Prompt for the datum-cli agent: run the script once, return its stdout. */
/** The Bash tool's maximum timeout (ms). A batch may run a full test suite;
 *  the tool's two-minute default cut three INT-lane verifies (#496). */
export const BATCH_TOOL_TIMEOUT_MS = 600000
/** A runner reply saying its shell cut the script short. */
export const TIMEOUT_RE = /timed out after|"error"\s*:\s*"timeout"|Command timed out/i

export function batchCommandPrompt(steps: BatchStep[]): string {
  return (
    `Run exactly this script with the Bash tool in ONE invocation, with the Bash tool's timeout parameter ${BATCH_TOOL_TIMEOUT_MS} (the script may run a whole test suite; the default two minutes is too short), and return only its stdout, nothing else. ` +
    'Do not run the steps one at a time, do not retry or "fix" a failing step, do not ask for clarification, ' +
    'do not message anyone, do not summarise or explain — this prompt is the whole task. ' +
    'The script prints one JSON array (one object per step: name, exit_code, stdout, stderr); ' +
    'a non-zero exit_code is data to return, not a problem to solve.\n\n' +
    (cacheKey ? `(inputs fingerprint ${cacheKey} — informational, do not act on it)\n\n` : '') +
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
  if (!Array.isArray(arr)) {
    // A reply that is only code fences ("``` ```", wf_aec6a61b-94a task-007)
    // is an empty reply, not prose: it must take the empty-reply retry, not
    // be named runner_no_json.
    const text = typeof raw === 'string' ? raw.replace(/```[a-z]*/gi, '').trim() : ''
    if (!text) return { steps: [], failed: null, missing: true }
    const prose = (raw as string).trim()
    // #496 (integration-lanes-2 wf_355fd4cc-76b): the runner's Bash tool cut
    // a full-suite verify at its two-minute default and said so in prose, as
    // {"error":"timeout"} or as a 143 row. Named, and retried once with the
    // timeout instruction repeated; never a refusal, never "the tests failed".
    if (TIMEOUT_RE.test(prose)) {
      return { steps: [], failed: null, missing: true, scriptError: `batch_timeout: the runner's shell cut the script before it finished (runner said: "${prose.replace(/\s+/g, ' ').slice(0, 160)}"); the Bash tool must be called with timeout ${BATCH_TOOL_TIMEOUT_MS}` }
    }
    // wf_4cd23ab6-9f8 boot: the runner described the host's refusal in prose
    // ("exited with code 126 ... failed to execute"). Same failure, same name.
    const exited = /exit(?:ed)?(?: with)? code (\d+)/i.exec(prose)
    if (exited && /\b126\b|cannot execute|failed to execute/i.test(prose)) {
      return { steps: [], failed: null, missing: true, refusal: prose, scriptError: `batch_script_failed: the batch script exited ${exited[1]} before any step ran (the host shell refused to execute it; runner said: "${prose.replace(/\s+/g, ' ').slice(0, 160)}")` }
    }
    // monotonic-task-ids task-006 (#539): the reply IS the step array, cut
    // before it closed — the runner ran the script and could not relay all
    // of its stdout. Named, and retried once by runBatch like an empty reply;
    // never prose, never "the count gate returned nothing".
    if (/^\[\s*\{\s*"name"\s*:/.test(text)) {
      const names = [...text.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map((m) => m[1])
      const complete = names.slice(0, -1)
      return { steps: [], failed: null, missing: true, scriptError: `batch_truncated: the runner's reply is a step array cut before it closed (${text.length} chars; last complete step: ${complete[complete.length - 1] ?? 'none'}; cut inside: ${names[names.length - 1] ?? 'unknown'}) — the script's stdout was too long to relay whole` }
    }
    return { steps: [], failed: null, missing: true, refusal: prose }
  }
  const results = arr.map(asStepResult).filter((r): r is BatchStepResult => r !== null)
  // "[]" is an empty reply, not a batch that ran nothing (wf_d80acceb-e3e
  // boot: the host refused the script and the runner answered with []).
  if (results.length === 0) return { steps: [], failed: null, missing: true }
  if (results.length === 1 && results[0].name === '__script' && results[0].exit_code !== 0) {
    const { exit_code, stderr } = results[0]
    // The guards (root, jq, hash) name themselves on stderr. A silent non-zero
    // exit is the host refusing the script before any step ran (exit 126 at
    // boot, wf_d913ace6-62c): named, never "the runner said nothing".
    // Only datum's own guards name themselves on stderr; any other text on a
    // before-any-step exit is the runner's wording for the host refusing the
    // script (wf_f79286ec-09d: "Command not found or permission denied").
    const guard = /^batch_(script_corrupt|root_missing|tool_missing)\b/.test(stderr.trim())
    const scriptError = guard
      ? stderr.trim()
      : `batch_script_failed: the batch script exited ${exit_code} before any step ran (the host shell refused to execute it; exit 126 is "cannot execute")${stderr.trim() ? `; runner said: "${stderr.trim().replace(/\s+/g, ' ').slice(0, 160)}"` : ''}`
    return scriptError.startsWith('batch_script_corrupt')
      ? { steps: [], failed: null, missing: true, corrupt: scriptError, scriptError }
      : { steps: [], failed: null, missing: true, scriptError }
  }
  const tolerant = new Set(steps.filter((s) => s.tolerant).map((s) => s.name))
  // #517: a record __rec could not encode is the batch's failure whatever
  // its exit code — its stdout is empty by construction, not by result.
  const recFailed = results.find((r) => r.stderr.startsWith('batch_rec_failed:')) ?? null
  const failed = recFailed ?? results.find((r) => r.exit_code !== 0 && !tolerant.has(r.name)) ?? null
  // #341 wf_a7f50762-9d3 task-008: 10 of 13 tolerant steps came back and the
  // lane died test_count_missing. The script stops early only after a
  // non-tolerant failure, so any other short array is the runner returning
  // a partial result — named, and missing, never "those steps did not run".
  const last = results[results.length - 1]
  const stoppedByFailFast = failed !== null && last?.name === failed.name && !tolerant.has(failed.name)
  if (results.length < steps.length && !stoppedByFailFast) {
    const returned = new Set(results.map((r) => r.name))
    const absent = steps.map((s) => s.name).filter((n) => !returned.has(n))
    return {
      steps: [],
      failed: null,
      missing: true,
      scriptError: `batch_incomplete: ${results.length} of ${steps.length} step records returned and no non-tolerant failure stopped the batch — the runner returned a partial result (last record: ${last?.name ?? 'none'}); absent: [${absent.join(', ')}]`,
    }
  }
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
/** A runner reply that reads as a host permission refusal (elonchesd wf_2bf3cc14-899). */
export const REFUSAL_RE = /\b(permission|denied|blocked|classifier|not allowed|refused?|unable to (?:run|execute)|can(?:no|')t (?:run|execute))\b/i

/** Does a runner's prose reply read as a host permission refusal? */
export function isRunnerRefusal(reply: string): boolean {
  return REFUSAL_RE.test(reply)
}

export function describeFailure(r: BatchResult, label: string): string {
  if (r.missing) {
    if (r.corrupt) return `${label}: batch_script_corrupt — the runner did not run the script it was given (${r.corrupt})`
    if (r.scriptError) return `${label}: ${r.scriptError}`
    // elonchesd wf_dee84cc2-e64: an empty reply read as a red suite. Named.
    if (!r.refusal) return `${label}: runner_empty_result — batch agent returned no parseable result (empty reply)`
    const excerpt = r.refusal.replace(/\s+/g, ' ').slice(0, 300)
    if (REFUSAL_RE.test(r.refusal)) {
      return `${label}: runner_permission_denied — the datum-cli runner was refused by the host permission classifier and replied in prose; the commands in this batch need an allow-rule for this repo: "${excerpt}"`
    }
    return `${label}: runner_no_json — batch agent returned no parseable result (reply: "${excerpt}")`
  }
  if (!r.failed) return `${label}: ok`
  const tail = (r.failed.stderr || r.failed.stdout).trim().split('\n').slice(-5).join('\n')
  return `${label}: step "${r.failed.name}" exited ${r.failed.exit_code}${tail ? ` — ${tail}` : ''}`
}
