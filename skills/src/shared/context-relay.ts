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
import { utf8ByteLength, utf8BytesToString } from './utf8'
import { base64Decode } from './base64'

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

// ── CHUNKED inline mode — a file that MUST be in-script (the lane plan) but
// is over the relay budget: no deferring it to a consuming agent, because
// the caller (not an LLM) needs the parsed JSON to schedule lanes.
//
// Never relay this kind of file through an LLM echo: an elonchesd run
// (wf_6bfbd9f2-510) had a 56 124-byte lane-plan.json come back from a
// `datum-reader` agent with 5 of 18 lanes' acceptance_criteria silently
// "corrected" — "§4" became "§ 4" — which changed laneSpecHash() for those
// lanes and re-scheduled, re-ran and re-merged already-completed work. The
// shape check (verifyLanePlanShape) passed because the shape (lane ids,
// counts) was intact; only the bytes inside a field had been touched.
//
// So the file is read in fixed-size byte windows via `tail -c +N | head -c
// L`, each window base64-encoded before it ever reaches an LLM turn — there
// is no typography left in a base64 stream for a runner to "fix". Chunk
// boundaries are chosen purely from the probed byte count (never from
// decoded text), so a boundary can land inside a multibyte UTF-8 character;
// that is fine because bytes are decoded to base64 (not UTF-8) per chunk and
// concatenated as BYTES, with the single UTF-8 decode happening once, after
// every byte is back, per shared/utf8.ts's utf8BytesToString contract.
// tested-by: skills/src/shared/context-relay.test.ts

/** Fixed-size byte windows covering `bytes`, in order. A zero/negative size
 *  (file absent, or the probe found nothing) yields a single empty window
 *  rather than throwing — the caller decides what an empty file means. */
/** Raw bytes per chunk. base64 expands 4/3, so 12 KB of file is 16 KB on
 *  the step's stdout — the same budget the inline relay keeps under the
 *  harness's ~25 KB spill. A 16 KB chunk would be ~22 KB of base64: too
 *  close to the threshold that produced the fabricated relay in the first
 *  place. */
export const CONTEXT_CHUNK_BYTES = 12 * 1024

export function contextChunkPlan(bytes: number, budget: number = CONTEXT_CHUNK_BYTES): Array<{ offset: number; length: number }> {
  if (!Number.isFinite(bytes) || bytes <= 0) return [{ offset: 0, length: 0 }]
  const chunks: Array<{ offset: number; length: number }> = []
  let offset = 0
  while (offset < bytes) {
    const length = Math.min(budget, bytes - offset)
    chunks.push({ offset, length })
    offset += length
  }
  return chunks
}

/** `tail -c +<offset+1> file | head -c <length>` — the byte-window read, shared
 *  by both the base64 payload step and its independent `wc -c` witness. */
function chunkWindowCommand(relPath: string, offset: number, length: number): string {
  return `tail -c +${offset + 1} ${q(relPath)} | head -c ${length}`
}

/**
 * Two steps per chunk: `ctx-chunk-<i>` is the window's bytes, base64-encoded
 * (immune to text normalisation); `ctx-chunk-wc-<i>` is `wc -c` over the SAME
 * pre-base64 window, so the assembler can catch a truncated/garbled payload
 * before it ever base64-decodes it.
 */
export function contextChunkSteps(relPath: string, chunk: { offset: number; length: number }, i: number): BatchStep[] {
  const window = chunkWindowCommand(relPath, chunk.offset, chunk.length)
  return [
    { name: `ctx-chunk-${i}`, command: `${window} | base64`, tolerant: true },
    { name: `ctx-chunk-wc-${i}`, command: `${window} | wc -c | tr -d ' '`, tolerant: true },
  ]
}

function stdoutAcross(results: BatchResult[], name: string): string | null {
  for (const r of results) {
    const s = stepStdout(r, name)
    if (s !== null) return s
  }
  return null
}

/**
 * Assemble the byte-windows produced by contextChunkSteps back into the
 * original file's text, byte-verified at every stage:
 *  - each chunk's base64 payload decodes to exactly its declared `wc -c`
 *    count AND its planned length (a short/garbled/missing chunk step is
 *    named individually, not folded into one generic failure);
 *  - the concatenated byte total matches the probe's byte count for the
 *    whole file.
 * `chunkResults` may be one BatchResult per chunk (one agent() call each,
 * via stageOpts('cli')) or fewer, larger batches — steps are looked up by
 * name across all of them, in order, so either shape works.
 * `sha` is carried through purely for the error text / caller logging: there
 * is no SHA-1 implementation available in the sandbox to re-derive a git
 * blob hash here, so it is never itself a pass/fail condition — the byte
 * counts are.
 */
export function contextAssembleChunks(
  relPath: string,
  probeBytes: number,
  sha: string,
  chunkResults: BatchResult[],
  plan: Array<{ offset: number; length: number }>,
): string {
  let bytes: number[] = []
  plan.forEach((chunk, i) => {
    const b64 = stdoutAcross(chunkResults, `ctx-chunk-${i}`)
    const wcRaw = stdoutAcross(chunkResults, `ctx-chunk-wc-${i}`)
    if (b64 === null || wcRaw === null) {
      throw new Error(`context_relay_mismatch: ${relPath} chunk ${i} produced no result (sha ${sha || '?'})`)
    }
    const declared = parseInt(wcRaw.trim(), 10)
    let decoded: number[]
    try {
      decoded = base64Decode(b64.trim())
    } catch (exc) {
      throw new Error(`context_relay_mismatch: ${relPath} chunk ${i} was not valid base64 — ${(exc as Error).message}`)
    }
    if (!Number.isFinite(declared) || decoded.length !== declared) {
      throw new Error(`context_relay_mismatch: ${relPath} chunk ${i} expected ${declared} bytes (wc -c), got ${decoded.length} bytes`)
    }
    if (decoded.length !== chunk.length) {
      throw new Error(`context_relay_mismatch: ${relPath} chunk ${i} expected planned length ${chunk.length} bytes, got ${decoded.length} bytes`)
    }
    bytes = bytes.concat(decoded)
  })
  if (bytes.length !== probeBytes) {
    throw new Error(`context_relay_mismatch: ${relPath} total expected ${probeBytes} bytes, got ${bytes.length} bytes (sha ${sha || '?'})`)
  }
  const assembled = utf8BytesToString(bytes)
  const actual = utf8ByteLength(assembled)
  if (actual !== probeBytes) {
    throw new Error(`context_relay_mismatch: ${relPath} total expected ${probeBytes} bytes, decoded string is ${actual} bytes`)
  }
  return assembled
}
