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
// the path and byte count (never the blob hash — that is the witness) and a mandatory instruction to
// read the file with the Read tool (contextSlot) — exact bytes by
// construction, no relay to verify.
// tested-by: skills/src/shared/context-relay.test.ts

import { stepStdout, batchCommandPrompt, type BatchResult, type BatchStep } from './batch'
import { utf8ByteLength, utf8Encode } from './utf8'
import { gitBlobSha } from './sha1'

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

/**
 * Phase 2: cat + wc -c for the inline subset only (indexed by that subset).
 * Every batch is a fresh shell, so this one defines `$__eb` itself: the
 * probe's definition did not carry over, `docs/epics/$__eb/TICKET.md`
 * resolved to docs/epics//TICKET.md, and refine halted with
 * context_relay_mismatch on a file the probe had just measured
 * (elonchesd wf_8913d90e-75f).
 */
export function contextInlineSteps(inlineFiles: string[]): BatchStep[] {
  const steps: BatchStep[] = [
    { name: 'branch', command: `__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"`, tolerant: true },
  ]
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
  /** Inline files whose relayed bytes did not verify: deferred, and the
   *  caller's cue to re-fetch once (contextInlineRetryPrompt + mergeRelayRetry). */
  mismatched: string[]
}

/**
 * The runner transcribes the batch RESULT as well as the script (caliper
 * eedom wf_9bf2c994-801, #566: one contiguous 340-byte span dropped from the
 * middle of an 8.4 KB QUESTIONS.md, the 6 KB TICKET beside it intact). The
 * script hash (batch.ts) guards what the runner executes, not what it hands
 * back, so every inlined file is verified against the probe's blob sha —
 * a same-length corruption passes a byte count — and one that does not
 * verify is DEFERRED to the consuming agent (path + bytes + mandatory Read
 * with a witness: exact bytes by construction), the path every over-budget
 * file already takes. Never a halt: the caller re-fetches once first.
 */
export function contextFromRelay(probe: BatchResult, inline: BatchResult | null, plan: ContextRelayPlan): RelayedContext {
  const branch = stepStdout(probe, 'branch') || ''
  const epicDir = stepStdout(probe, 'epic-dir') || `docs/epics/${branch}`
  const files: Record<string, ContextFile> = {}
  const warnings: string[] = []
  const mismatched: string[] = []

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
  const defer = (relPath: string, why: string): void => {
    mismatched.push(relPath)
    files[relPath] = { path: relPath, exists: true, inlined: false, bytes: plan.bytes[relPath], sha: plan.sha[relPath], content: null }
    warnings.push(`context_relay_mismatch: ${why} — deferred to the consuming agent`)
  }
  plan.inline.forEach((relPath, i) => {
    const raw = stepStdout(inline as BatchResult, `ctx-cat-${i}`)
    const declaredRaw = stepStdout(inline as BatchResult, `ctx-wc-${i}`)
    const declared = declaredRaw === null ? NaN : parseInt(declaredRaw.trim(), 10)
    if (raw === null || raw === NOT_FOUND_MARKER || declared === -1) {
      defer(relPath, `${relPath} existed at probe time (${plan.bytes[relPath]} bytes) but the inline read found nothing`)
      return
    }
    const expected = plan.bytes[relPath]
    const sha = plan.sha[relPath]
    let content = raw
    let actual = utf8ByteLength(raw)
    // The runner trimmed the LAST cat step's trailing newline (caliper eedom
    // wf_4f739141-c8c: 3695 of 3696 bytes, otherwise byte-identical). The
    // probe recorded the blob sha, which proves the bytes where a count only
    // measures them: a read one byte short is restored when content + "\n"
    // hashes to that sha, and rejected otherwise.
    if (actual === expected - 1 && sha && gitBlobSha(utf8Encode(raw + '\n')) === sha) {
      content = raw + '\n'
      actual = expected
      warnings.push(`context file ${relPath}: trailing newline restored (runner returned ${expected - 1} of ${expected} bytes; blob sha verified)`)
    }
    if (actual !== expected || (Number.isFinite(declared) && declared !== expected)) {
      defer(relPath, `${relPath} expected ${expected} bytes, got ${actual} bytes`)
      return
    }
    if (sha && gitBlobSha(utf8Encode(content)) !== sha) {
      defer(relPath, `${relPath} relayed ${actual} bytes as expected but the blob sha differs from the probe's (content rewritten in transit)`)
      return
    }
    files[relPath] = { path: relPath, exists: true, inlined: true, bytes: expected, sha, content }
  })
  return { branch, epicDir, files, warnings, mismatched }
}

/** The second inline attempt: same script, a distinct prompt (a cache miss on resume). */
export function contextInlineRetryPrompt(steps: BatchStep[]): string {
  return `${batchCommandPrompt(steps)}\n\n# attempt 2 of 2 — the previous runner returned one of these files with bytes missing; copy the script's output verbatim, every byte`
}

/**
 * Fold a re-fetch into the first relay: a file that mismatched on attempt 1
 * takes attempt 2's content when that verified; one that mismatched twice
 * stays deferred, and says so. Files that verified on attempt 1 are kept.
 */
export function mergeRelayRetry(first: RelayedContext, second: RelayedContext): RelayedContext {
  const files = { ...first.files }
  const warnings = [...first.warnings]
  const mismatched: string[] = []
  for (const relPath of first.mismatched) {
    const retried = second.files[relPath]
    if (retried && retried.inlined && retried.content !== null) {
      files[relPath] = retried
      warnings.push(`context file ${relPath}: re-fetched intact on attempt 2 (blob sha verified)`)
    } else {
      mismatched.push(relPath)
      warnings.push(`context file ${relPath}: mismatched on both attempts — deferred to the consuming agent (path + bytes + mandatory Read with a witness)`)
    }
  }
  return { branch: first.branch, epicDir: first.epicDir, files, warnings, mismatched }
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
    `Before doing anything else, read ${f.path} IN FULL with the Read tool (all ${f.bytes} bytes). ` +
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
    'The key is the file path exactly as written above; the value is the 12-character hash prefix. ' +
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
/** Shortest accepted witness prefix — git's own short-sha floor. The prompt asks for 12. */
export const WITNESS_MIN_HEX = 7

export interface ReadWitnessVerdict {
  ok: boolean
  missing: string[]
  mismatched: string[]
  tooShort: string[]
  /** Accepted on >= WITNESS_MIN_HEX correct leading hex chars although the
   *  cited value goes on to differ (a transcription slip after the proof). */
  nearMiss: string[]
}

/** Length of the common leading run of two lowercase strings. */
function commonPrefixLen(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
}

export function verifyReadWitness(
  files: ContextFile[],
  parsed: unknown,
): ReadWitnessVerdict {
  const deferred = files.filter((f) => f.exists && !f.inlined)
  const witness = extractWitnessMap(parsed)
  const missing: string[] = []
  const mismatched: string[] = []
  const tooShort: string[] = []
  const nearMiss: string[] = []
  // The VALUE is the proof (a prefix the agent can only get by hashing the
  // file); the key is bookkeeping. A haiku reflect agent keyed by the full
  // sha instead of the path (caliper wf_181691ac-fbf, BUG K), so any entry
  // whose value is a prefix of this file's sha counts for it. Agents also
  // returned correct 8/9-char prefixes (BUG K2): >= 7 hex chars is accepted.
  // Keys count too: a haiku lens returned {"<prefix>": "true"} (caliper BUG K3).
  // And a value whose LEADING >= 7 hex chars are right but which then
  // diverges (caliper eedom wf_751ea0e4-653: "8cc9785049da" for
  // 8cc97850499d…, one digit dropped while transcribing) is the same
  // evidence with a slip after it — accepted, and named a near miss.
  const candidates = [...Object.values(witness), ...Object.keys(witness)]
  const hexValues = candidates.filter((v): v is string => typeof v === 'string' && /^[0-9a-f]+$/i.test(v))
  const values = hexValues.filter((v) => v.length >= WITNESS_MIN_HEX)
  for (const f of deferred) {
    const sha = f.sha.toLowerCase()
    if (values.some((v) => sha.startsWith(v.toLowerCase()))) continue
    if (values.some((v) => commonPrefixLen(sha, v.toLowerCase()) >= WITNESS_MIN_HEX)) {
      nearMiss.push(f.path)
      continue
    }
    const keyed = witness[f.path]
    if (typeof keyed === 'string' && /^[0-9a-f]+$/i.test(keyed) && keyed.length < WITNESS_MIN_HEX && sha.startsWith(keyed.toLowerCase())) tooShort.push(f.path)
    else if (hexValues.some((v) => v.length < WITNESS_MIN_HEX && sha.startsWith(v.toLowerCase()))) tooShort.push(f.path)
    else if (typeof keyed === 'string' && keyed.length >= WITNESS_MIN_HEX) mismatched.push(f.path)
    else missing.push(f.path)
  }
  return { ok: missing.length === 0 && mismatched.length === 0 && tooShort.length === 0, missing, mismatched, tooShort, nearMiss }
}

/**
 * Throwing wrapper around verifyReadWitness for call sites that must not
 * silently continue on a failed witness (FLOW.md open gap 2). Names the
 * first offending path so the error is actionable.
 */
export function assertReadWitness(files: ContextFile[], parsed: unknown): ReadWitnessVerdict {
  const result = verifyReadWitness(files, parsed)
  if (result.ok) return result
  const witness = extractWitnessMap(parsed)
  const byPath = new Map(files.map((f) => [f.path, f]))
  const badPath = (result.tooShort[0] ?? result.missing[0] ?? result.mismatched[0]) as string
  const f = byPath.get(badPath)
  if (result.tooShort.includes(badPath)) {
    const sha = (f ? f.sha : '').toLowerCase()
    const short = Object.values(witness).find((v): v is string => typeof v === 'string' && v.length > 0 && sha.startsWith(v.toLowerCase())) || ''
    throw new Error(`context_read_unverified: ${badPath} — witness prefix too short (${short.length} < ${WITNESS_MIN_HEX}): the agent read the file but returned only "${short}" of blob ${f ? f.sha : '?'}`)
  }
  const got = witness[badPath]
  const gotStr = typeof got === 'string' && got.length > 0 ? got : 'missing'
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

