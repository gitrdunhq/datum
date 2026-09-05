// context-relay.ts — two-phase, budgeted relay of epic docs into scripts.
//
// Why two phases: a datum-cli batch is ONE bash invocation whose whole
// stdout is ONE tool result. When that result exceeds the harness's spill
// threshold (~25 KB) it is written to a file instead of the agent's
// context, and a maxTurns:3 haiku runner cannot echo it — in dogfooding it
// returned a fabricated JSON with the byte count rewritten to match
// (caught by the byte check as context_relay_mismatch, so nothing silently
// planned on a fake SPEC, but the run was blocked). No amount of chunking
// inside the batch changes the size of that single result.
//
// So the relay never carries a large file. Phase 1 (contextProbeSteps)
// reads only sizes and hashes; contextRelayPlan picks, greedily in order,
// the files whose total fits CONTEXT_RELAY_BUDGET_BYTES; phase 2
// (contextInlineSteps) cats exactly those and contextFromRelay
// byte-verifies them. Everything else is DEFERRED: the consuming agent gets
// the path, byte count and git blob hash and a mandatory instruction to
// read the file with the Read tool (contextSlot) — exact bytes by
// construction, no relay to verify.
// tested-by: skills/src/shared/context-relay.test.ts

import { stepStdout, type BatchResult, type BatchStep } from './batch'
import { utf8ByteLength } from './utf8'

/** Total bytes one inline batch may relay — well under the ~25 KB spill. */
export const CONTEXT_RELAY_BUDGET_BYTES = 16 * 1024

const NOT_FOUND_MARKER = '__DATUM_CTXFILE_NOT_FOUND__'

/** Double-quote a path for bash; `$__eb` inside stays expandable on purpose. */
function q(p: string): string {
  return `"${p.replace(/(["\\`])/g, '\\$1')}"`
}

export interface ContextProbeOpts {
  /** Repo-relative paths; `$__eb` expands to the current branch. */
  files: string[]
  /** Small deterministic reads to ride along (all tolerant, in order). */
  extraCommands?: { name: string; command: string }[]
}

export function contextProbeSteps(o: ContextProbeOpts): BatchStep[] {
  const steps: BatchStep[] = [
    { name: 'branch', command: `__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"`, tolerant: true },
    { name: 'epic-dir', command: `printf 'docs/epics/%s' "$__eb"`, tolerant: true },
  ]
  o.files.forEach((relPath, i) => {
    steps.push({
      name: `ctx-wc-${i}`,
      command: `if [ -f ${q(relPath)} ]; then wc -c < ${q(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
      tolerant: true,
    })
    steps.push({
      name: `ctx-sha-${i}`,
      command: `if [ -f ${q(relPath)} ]; then git hash-object ${q(relPath)}; else printf ''; fi`,
      tolerant: true,
    })
  })
  for (const extra of o.extraCommands || []) {
    steps.push({ name: extra.name, command: extra.command, tolerant: true })
  }
  return steps
}

export interface ContextRelayPlan {
  files: string[]
  inline: string[]
  deferred: string[]
  missing: string[]
  bytes: Record<string, number>
  sha: Record<string, string>
  budget: number
}

export function contextRelayPlan(probe: BatchResult, files: string[], budget: number = CONTEXT_RELAY_BUDGET_BYTES): ContextRelayPlan {
  if (probe.missing) {
    throw new Error('context_relay_mismatch: probe batch returned no parseable result — cannot size the context files')
  }
  const plan: ContextRelayPlan = { files, inline: [], deferred: [], missing: [], bytes: {}, sha: {}, budget }
  let used = 0
  files.forEach((relPath, i) => {
    const wcRaw = stepStdout(probe, `ctx-wc-${i}`)
    const bytes = wcRaw === null ? NaN : parseInt(wcRaw.trim(), 10)
    const sha = (stepStdout(probe, `ctx-sha-${i}`) || '').trim()
    if (!Number.isFinite(bytes) || bytes < 0) {
      plan.missing.push(relPath)
      plan.bytes[relPath] = -1
      plan.sha[relPath] = ''
      return
    }
    plan.bytes[relPath] = bytes
    plan.sha[relPath] = sha
    if (used + bytes <= budget) {
      plan.inline.push(relPath)
      used += bytes
    } else {
      plan.deferred.push(relPath)
    }
  })
  return plan
}

/** Phase 2: cat + wc -c for the inline subset only (indexed by that subset). */
export function contextInlineSteps(inlineFiles: string[]): BatchStep[] {
  const steps: BatchStep[] = []
  inlineFiles.forEach((relPath, i) => {
    steps.push({
      name: `ctx-cat-${i}`,
      command: `if [ -f ${q(relPath)} ]; then cat ${q(relPath)}; else printf '%s' '${NOT_FOUND_MARKER}'; fi`,
      tolerant: true,
    })
    steps.push({
      name: `ctx-wc-${i}`,
      command: `if [ -f ${q(relPath)} ]; then wc -c < ${q(relPath)} | tr -d ' '; else printf -- '-1'; fi`,
      tolerant: true,
    })
  })
  return steps
}

export interface ContextFile {
  path: string
  exists: boolean
  inlined: boolean
  bytes: number
  sha: string
  content: string | null
}

export interface RelayedContext {
  branch: string
  epicDir: string
  files: Record<string, ContextFile>
  warnings: string[]
}

export function contextFromRelay(probe: BatchResult, inline: BatchResult | null, plan: ContextRelayPlan): RelayedContext {
  const branch = stepStdout(probe, 'branch') || ''
  const epicDir = stepStdout(probe, 'epic-dir') || `docs/epics/${branch}`
  const files: Record<string, ContextFile> = {}
  const warnings: string[] = []

  if (plan.inline.length > 0 && (inline === null || inline.missing)) {
    throw new Error(`context_relay_mismatch: inline batch returned no parseable result for ${plan.inline.join(', ')}`)
  }

  for (const relPath of plan.missing) {
    files[relPath] = { path: relPath, exists: false, inlined: false, bytes: -1, sha: '', content: null }
  }
  for (const relPath of plan.deferred) {
    files[relPath] = { path: relPath, exists: true, inlined: false, bytes: plan.bytes[relPath], sha: plan.sha[relPath], content: null }
    warnings.push(`context file ${relPath}: ${plan.bytes[relPath]} bytes, deferred to the consuming agent (relay budget ${plan.budget} bytes)`)
  }
  plan.inline.forEach((relPath, i) => {
    const raw = stepStdout(inline as BatchResult, `ctx-cat-${i}`)
    const declaredRaw = stepStdout(inline as BatchResult, `ctx-wc-${i}`)
    const declared = declaredRaw === null ? NaN : parseInt(declaredRaw.trim(), 10)
    if (raw === null || raw === NOT_FOUND_MARKER || declared === -1) {
      throw new Error(`context_relay_mismatch: ${relPath} existed at probe time (${plan.bytes[relPath]} bytes) but the inline read found nothing`)
    }
    const expected = plan.bytes[relPath]
    const actual = utf8ByteLength(raw)
    if (actual !== expected || (Number.isFinite(declared) && declared !== expected)) {
      throw new Error(`context_relay_mismatch: ${relPath} expected ${expected} bytes, got ${actual} bytes`)
    }
    files[relPath] = { path: relPath, exists: true, inlined: true, bytes: expected, sha: plan.sha[relPath], content: raw }
  })
  return { branch, epicDir, files, warnings }
}

/**
 * What goes into a prompt's `{{xContent}}` slot: the verified content for
 * an inlined file, or a mandatory Read instruction for a deferred one.
 * Callers check `exists` first — a missing file is their decision to make.
 */
export function contextSlot(f: ContextFile): string {
  if (!f.exists) throw new Error(`context file ${f.path} does not exist — caller must handle a missing file before building the prompt`)
  if (f.inlined && f.content !== null) return f.content
  return (
    `[FILE NOT INLINED — ${f.bytes} bytes is over the relay budget]\n` +
    `Before doing anything else, read ${f.path} IN FULL with the Read tool (all ${f.bytes} bytes; git blob ${f.sha}). ` +
    `Treat its contents exactly as if they were pasted here. Do not summarise it, do not skip sections, and do not proceed on memory of a previous read.`
  )
}

/**
 * FLOW.md open gap 2 — a deferred contextSlot() instruction tells the agent
 * to read a file, but nothing verifies it did. This is the deterministic
 * witness: for the deferred files only, an appended prompt paragraph that
 * requires the agent's JSON output to carry the file's blob hash — a hash
 * it can only produce by running `git hash-object` itself, which it can
 * only do usefully after actually reading the path. Returns '' when every
 * file is inlined, so prompts stay byte-identical to today's when nothing
 * is deferred.
 */
export function contextWitnessInstruction(files: ContextFile[]): string {
  const deferred = files.filter((f) => f.exists && !f.inlined)
  if (deferred.length === 0) return ''
  const entries = deferred
    .map((f) => `    "${f.path}": "<first 12 hex chars of the blob hash — run \`git hash-object ${f.path}\` with the Bash tool and copy its output>"`)
    .join(',\n')
  return (
    '\n\nMANDATORY READ WITNESS: for every file above marked [FILE NOT INLINED], you must actually read it, ' +
    'then run `git hash-object <path>` yourself with the Bash tool for that exact path and copy its output. ' +
    'Your JSON response MUST include a "read_witness" field, keyed by path, whose value is the first 12 hex ' +
    'characters of that command\'s output — taken from the first line of the file you read, computed fresh, ' +
    'never guessed or reused from memory:\n' +
    '{\n  "read_witness": {\n' + entries + '\n  }\n}\n' +
    'Your JSON response is invalid without this field for every file listed above.'
  )
}

function extractWitnessMap(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const w = (parsed as Record<string, unknown>).read_witness
  if (!w || typeof w !== 'object' || Array.isArray(w)) return {}
  return w as Record<string, unknown>
}

/**
 * Pure check: does `parsed` (an agent's parsed JSON output) carry a
 * `read_witness` entry for every deferred file, whose value is a ≥12-hex-char
 * prefix of that file's actual blob sha? Inlined files are not required —
 * the relay already byte-verified their content.
 */
export function verifyReadWitness(
  files: ContextFile[],
  parsed: unknown,
): { ok: boolean; missing: string[]; mismatched: string[] } {
  const deferred = files.filter((f) => f.exists && !f.inlined)
  const witness = extractWitnessMap(parsed)
  const missing: string[] = []
  const mismatched: string[] = []
  for (const f of deferred) {
    const value = witness[f.path]
    if (typeof value !== 'string' || !/^[0-9a-f]{12,}$/i.test(value)) {
      missing.push(f.path)
      continue
    }
    if (!f.sha.toLowerCase().startsWith(value.toLowerCase())) {
      mismatched.push(f.path)
    }
  }
  return { ok: missing.length === 0 && mismatched.length === 0, missing, mismatched }
}

/**
 * Throwing wrapper around verifyReadWitness for call sites that must not
 * silently continue on a failed witness (FLOW.md open gap 2). Names the
 * first offending path so the error is actionable.
 */
export function assertReadWitness(files: ContextFile[], parsed: unknown): void {
  const result = verifyReadWitness(files, parsed)
  if (result.ok) return
  const witness = extractWitnessMap(parsed)
  const byPath = new Map(files.map((f) => [f.path, f]))
  const badPath = (result.missing[0] ?? result.mismatched[0]) as string
  const got = witness[badPath]
  const gotStr = typeof got === 'string' && got.length > 0 ? got : 'missing'
  const f = byPath.get(badPath)
  throw new Error(`context_read_unverified: ${badPath} — agent did not evidence reading the deferred file (expected blob ${f ? f.sha : '?'}, got ${gotStr})`)
}

/**
 * Witness instruction for an agent whose contract is a bare JSON ARRAY
 * (decompose-tasks → tasks.json): an array has no slot for read_witness, so
 * when — and only when — something is deferred, the agent is told to wrap
 * its array as `{ "read_witness": {...}, "<key>": [...] }`. Returns '' when
 * nothing is deferred, so the bare-array prompt stays byte-identical.
 * Pair with unwrapWitnessedArray(), which accepts both shapes.
 */
export function contextWitnessWrapInstruction(files: ContextFile[], key: string): string {
  const base = contextWitnessInstruction(files)
  if (base === '') return ''
  return (
    base +
    `\nBecause this response would otherwise be a bare JSON array, return a single JSON object instead: ` +
    `{"read_witness": {...}, "${key}": <the array described above, unchanged>}. ` +
    `The array itself keeps exactly the schema above.`
  )
}

/**
 * Pure: the array an array-contract agent returned, whether bare or wrapped
 * by contextWitnessWrapInstruction(). null when neither shape is present —
 * callers treat that exactly like an empty result.
 */
export function unwrapWitnessedArray(parsed: unknown, key: string): unknown[] | null {
  if (Array.isArray(parsed)) return parsed
  if (!parsed || typeof parsed !== 'object') return null
  const inner = (parsed as Record<string, unknown>)[key]
  return Array.isArray(inner) ? inner : null
}

