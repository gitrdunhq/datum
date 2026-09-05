// Two-phase context relay (replaces readContextSteps/contextFromSteps).
//
// Dogfooding evidence (run wf_fcf49a90-0bf): a 31 KB SPEC.md was cat'ed
// correctly by the datum-cli batch, but the harness spilled the >~25 KB tool
// result to a file, the haiku runner could not echo it, and it RETURNED A
// FABRICATED JSON — 8 780 bytes of invented prose with the wc count rewritten
// to match. The byte check caught it (context_relay_mismatch), so nothing
// silently planned on a fake SPEC, but the relay itself can never carry a
// large file. Chunking inside one batch does not help: the whole batch's
// stdout is ONE tool result.
//
// So: no LLM echoes a large file. Phase 1 probes sizes + hashes (tiny);
// phase 2 inlines only the files that fit a per-batch budget well under the
// spill threshold, byte-verified as before; everything else is handed to the
// consuming agent by path + bytes + hash with a mandatory Read instruction.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { batchScript, parseBatchResult, type BatchResult, type BatchStep } from './batch'
import {
  CONTEXT_RELAY_BUDGET_BYTES,
  contextProbeSteps,
  contextRelayPlan,
  contextInlineSteps,
  contextFromRelay,
  contextSlot,
  contextWitnessInstruction,
  contextWitnessWrapInstruction,
  unwrapWitnessedArray,
  verifyReadWitness,
  assertReadWitness,
  type ContextFile,
} from './context-relay'
import { gitBlobSha } from './sha1'

const names = (steps: BatchStep[]) => steps.map((s) => s.name)

function fake(stdouts: Record<string, string>, exits: Record<string, number> = {}): BatchResult {
  return {
    steps: Object.entries(stdouts).map(([name, stdout]) => ({ name, exit_code: exits[name] ?? 0, stdout, stderr: '' })),
    failed: null,
    missing: false,
  }
}

describe('contextProbeSteps', () => {
  it('leads with branch/epic-dir, then wc -c + git hash-object per file, then extras — all tolerant, no cat', () => {
    const steps = contextProbeSteps({
      files: ['docs/epics/$__eb/SPEC.md', 'docs/epics/$__eb/TASKS.md'],
      extraCommands: [{ name: 'agent-types', command: 'jq -r .agent_types .datum/config.json' }],
    })
    expect(names(steps)).toEqual(['branch', 'epic-dir', 'ctx-wc-0', 'ctx-sha-0', 'ctx-wc-1', 'ctx-sha-1', 'agent-types'])
    expect(steps.every((s) => s.tolerant)).toBe(true)
    expect(steps.find((s) => s.name === 'ctx-wc-0')!.command).toContain('wc -c')
    expect(steps.find((s) => s.name === 'ctx-sha-0')!.command).toContain('git hash-object')
    expect(steps.some((s) => /\bcat\b/.test(s.command))).toBe(false)
  })
})

describe('contextRelayPlan', () => {
  const files = ['A.md', 'B.md', 'C.md', 'D.md']
  const probe = fake({
    branch: 'b', 'epic-dir': 'docs/epics/b',
    'ctx-wc-0': '10000', 'ctx-sha-0': 'aaa',
    'ctx-wc-1': '12000', 'ctx-sha-1': 'bbb',
    'ctx-wc-2': '5000', 'ctx-sha-2': 'ccc',
    'ctx-wc-3': '-1', 'ctx-sha-3': '',
  })

  it('inlines files greedily in order while the running total fits the budget; the rest are deferred', () => {
    const plan = contextRelayPlan(probe, files, 16 * 1024)
    expect(plan.inline).toEqual(['A.md', 'C.md']) // 10000 + 12000 > 16384, 10000 + 5000 fits
    expect(plan.deferred).toEqual(['B.md'])
    expect(plan.missing).toEqual(['D.md'])
    expect(plan.bytes['B.md']).toBe(12000)
    expect(plan.sha['A.md']).toBe('aaa')
  })

  it('defaults to a budget well under the harness spill threshold', () => {
    expect(CONTEXT_RELAY_BUDGET_BYTES).toBeLessThanOrEqual(16 * 1024)
    expect(contextRelayPlan(probe, files).inline).toEqual(['A.md', 'C.md'])
  })

  it('a single file over the budget is deferred, never inlined', () => {
    const p = fake({ branch: 'b', 'epic-dir': 'x', 'ctx-wc-0': String(31133), 'ctx-sha-0': 'big' })
    const plan = contextRelayPlan(p, ['SPEC.md'])
    expect(plan.inline).toEqual([])
    expect(plan.deferred).toEqual(['SPEC.md'])
  })

  it('a missing probe (batch never ran) is a named failure, not "no files"', () => {
    expect(() => contextRelayPlan({ steps: [], failed: null, missing: true }, ['SPEC.md'])).toThrow(/context_relay_mismatch/)
  })
})

describe('contextInlineSteps', () => {
  it('defines $__eb itself, then cats + wc -c only the inline subset, indexed by position in that subset', () => {
    const steps = contextInlineSteps(['A.md', 'C.md'])
    expect(names(steps)).toEqual(['branch', 'ctx-cat-0', 'ctx-wc-0', 'ctx-cat-1', 'ctx-wc-1'])
    expect(steps[0].command).toBe(`__eb=$(git rev-parse --abbrev-ref HEAD) && printf '%s' "$__eb"`)
    expect(steps[3].command).toContain('C.md')
    expect(steps.every((s) => s.tolerant)).toBe(true)
  })

  // elonchesd wf_8913d90e-75f: the probe batch defined `__eb`, the inline
  // batch is a NEW shell that did not, so `docs/epics/$__eb/TICKET.md`
  // resolved to docs/epics//TICKET.md and refine halted with
  // context_relay_mismatch on a 5940-byte file the probe had just measured.
  it('under real bash, a $__eb-templated path resolves in the inline batch on its own', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-ctx-eb-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'datum/x'], { cwd: dir })
      execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: dir })
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'base'], { cwd: dir })
      execFileSync('mkdir', ['-p', join(dir, 'docs/epics/datum/x')])
      writeFileSync(join(dir, 'docs/epics/datum/x/TICKET.md'), '# ticket\n')
      const steps = contextInlineSteps(['docs/epics/$__eb/TICKET.md'])
      const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' })
      const r = parseBatchResult(out, steps)
      expect(r.steps.find((s) => s.name === 'ctx-cat-0')?.stdout).toBe('# ticket\n')
      expect(r.steps.find((s) => s.name === 'ctx-wc-0')?.stdout.trim()).toBe('9')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('contextFromRelay', () => {
  const files = ['A.md', 'B.md', 'D.md']
  const probe = fake({
    branch: 'datum/x', 'epic-dir': 'docs/epics/datum/x',
    'ctx-wc-0': '5', 'ctx-sha-0': 'aaa',
    'ctx-wc-1': '31133', 'ctx-sha-1': 'bbb',
    'ctx-wc-2': '-1', 'ctx-sha-2': '',
  })

  it('returns verified content for inlined files, a path/bytes/sha descriptor for deferred ones, and exists=false for missing', () => {
    const plan = contextRelayPlan(probe, files)
    const inline = fake({ 'ctx-cat-0': 'hello', 'ctx-wc-0': '5' })
    const ctx = contextFromRelay(probe, inline, plan)
    expect(ctx.branch).toBe('datum/x')
    expect(ctx.epicDir).toBe('docs/epics/datum/x')
    expect(ctx.files['A.md']).toEqual({ path: 'A.md', exists: true, inlined: true, bytes: 5, sha: 'aaa', content: 'hello' })
    expect(ctx.files['B.md']).toEqual({ path: 'B.md', exists: true, inlined: false, bytes: 31133, sha: 'bbb', content: null })
    expect(ctx.files['D.md'].exists).toBe(false)
    expect(ctx.files['D.md'].content).toBeNull()
    expect(ctx.warnings.join(' ')).toMatch(/B\.md.*31133 bytes.*deferred/)
  })

  it('throws context_relay_mismatch when an inlined file\'s bytes differ from the probe', () => {
    const plan = contextRelayPlan(probe, files)
    const inline = fake({ 'ctx-cat-0': 'hell', 'ctx-wc-0': '5' })
    expect(() => contextFromRelay(probe, inline, plan)).toThrow(/context_relay_mismatch: A\.md expected 5 bytes, got 4 bytes/)
  })

  it('throws context_relay_mismatch when the inline batch is missing but the plan needed it', () => {
    const plan = contextRelayPlan(probe, files)
    expect(() => contextFromRelay(probe, { steps: [], failed: null, missing: true }, plan)).toThrow(/context_relay_mismatch/)
  })

  it('accepts a null inline batch when nothing was planned for inlining', () => {
    const p = fake({ branch: 'b', 'epic-dir': 'x', 'ctx-wc-0': '31133', 'ctx-sha-0': 'bbb' })
    const plan = contextRelayPlan(p, ['SPEC.md'])
    const ctx = contextFromRelay(p, null, plan)
    expect(ctx.files['SPEC.md'].inlined).toBe(false)
  })
})

describe('contextSlot', () => {
  it('is the content itself for an inlined file', () => {
    expect(contextSlot({ path: 'A.md', exists: true, inlined: true, bytes: 5, sha: 'aaa', content: 'hello' })).toBe('hello')
  })

  it('is a mandatory Read instruction naming path and bytes (never the sha — that is the witness) for a deferred file', () => {
    const slot = contextSlot({ path: 'docs/epics/datum/x/SPEC.md', exists: true, inlined: false, bytes: 31133, sha: 'bbb', content: null })
    expect(slot).toContain('docs/epics/datum/x/SPEC.md')
    expect(slot).toContain('31133')
    expect(slot).not.toContain('bbb')
    expect(slot).toMatch(/Read tool/)
    expect(slot).toMatch(/before/i)
  })

  it('throws for a missing file — callers must check exists first', () => {
    expect(() => contextSlot({ path: 'X.md', exists: false, inlined: false, bytes: -1, sha: '', content: null })).toThrow(/X\.md/)
  })
})

describe('contextWitnessInstruction', () => {
  const inlined: ContextFile = { path: 'A.md', exists: true, inlined: true, bytes: 5, sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', content: 'hello' }
  const deferred: ContextFile = { path: 'docs/epics/x/SPEC.md', exists: true, inlined: false, bytes: 31133, sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', content: null }
  const missing: ContextFile = { path: 'X.md', exists: false, inlined: false, bytes: -1, sha: '', content: null }

  it('is empty when every file is inlined — prompts stay byte-identical when nothing is deferred', () => {
    expect(contextWitnessInstruction([inlined])).toBe('')
  })

  it('is empty when there are no files at all', () => {
    expect(contextWitnessInstruction([])).toBe('')
  })

  it('ignores missing (non-existent) files — only deferred files need a witness', () => {
    expect(contextWitnessInstruction([missing])).toBe('')
  })

  it('appends a read_witness instruction naming the path and the git hash-object command, for deferred files only', () => {
    const instruction = contextWitnessInstruction([inlined, deferred])
    expect(instruction).not.toBe('')
    expect(instruction).toContain('read_witness')
    expect(instruction).toContain(deferred.path)
    expect(instruction).toContain(`git hash-object ${deferred.path}`)
    expect(instruction).not.toContain(inlined.path)
  })
})

describe('verifyReadWitness', () => {
  const deferredA: ContextFile = { path: 'A.md', exists: true, inlined: false, bytes: 100, sha: 'abcdef123456789012345678901234567890abcd', content: null }
  const deferredB: ContextFile = { path: 'B.md', exists: true, inlined: false, bytes: 200, sha: '1111111111222222222233333333334444444444', content: null }
  const inlined: ContextFile = { path: 'C.md', exists: true, inlined: true, bytes: 5, sha: 'ffffffffffffffffffffffffffffffffffffffff', content: 'hello' }

  it('is ok with no missing/mismatched when every deferred file has a matching read_witness prefix', () => {
    const result = verifyReadWitness([deferredA, inlined], { read_witness: { 'A.md': 'abcdef123456' } })
    expect(result).toEqual({ ok: true, missing: [], mismatched: [], tooShort: [] })
  })

  it('does not require a witness entry for an inlined file', () => {
    const result = verifyReadWitness([inlined], {})
    expect(result.ok).toBe(true)
  })

  it('accepts any prefix of at least 12 hex chars, not just an exact-length match', () => {
    const result = verifyReadWitness([deferredA], { read_witness: { 'A.md': 'abcdef123456789012' } })
    expect(result.ok).toBe(true)
  })

  // caliper wf_181691ac-fbf task-007 (BUG K): a haiku reflect agent keyed the
  // witness by the full sha instead of the path ({"<sha>": "<12 hex>"}). The
  // value is the proof; the key is bookkeeping. Any entry whose value is a
  // prefix of the file's blob sha counts for that file.
  it('accepts a witness keyed by something other than the path when its value is the right prefix', () => {
    expect(verifyReadWitness([deferredA], { read_witness: { 'abcdef123456789012345678901234567890abcd': 'abcdef123456' } }).ok).toBe(true)
    expect(verifyReadWitness([deferredA], { read_witness: { 'whatever': 'ABCDEF123456' } }).ok).toBe(true)
    // Two deferred files, both witnessed by value under wrong keys.
    expect(verifyReadWitness([deferredA, deferredB], { read_witness: { x: 'abcdef123456', y: '111111111122' } }).ok).toBe(true)
  })

  // caliper wf_c11a9109-d48 (BUG K2): agents returned correct 8- and 9-char
  // prefixes and the lane failed context_read_unverified. Seven hex chars
  // (git's own short-sha floor) is proof enough of the read; the prompt still
  // asks for 12.
  it('accepts a correct prefix of at least 7 hex chars, and rejects a shorter one by name', () => {
    expect(verifyReadWitness([deferredA], { read_witness: { 'A.md': 'abcdef12' } }).ok).toBe(true)
    expect(verifyReadWitness([deferredA], { read_witness: { 'A.md': 'abcdef1' } }).ok).toBe(true)
    const short = verifyReadWitness([deferredA], { read_witness: { 'A.md': 'abcdef' } })
    expect(short.ok).toBe(false)
    expect(short.tooShort).toEqual(['A.md'])
    expect(() => assertReadWitness([deferredA], { read_witness: { 'A.md': 'abcdef' } })).toThrow(/context_read_unverified: A\.md — witness prefix too short \(6 < 7\)/)
  })

  // caliper wf_2f49073d-f07 (BUG K3): a haiku lens returned {"<12-hex prefix>": "true"}
  // — the proof as the KEY. The evidence of the read is the prefix string
  // itself, wherever the model put it.
  it('accepts a correct prefix appearing as a key of the witness object', () => {
    expect(verifyReadWitness([deferredA], { read_witness: { 'abcdef123456': 'true' } }).ok).toBe(true)
    expect(verifyReadWitness([deferredA], { read_witness: { 'abcdef1234567890': true } }).ok).toBe(true)
  })

  it('a wrong-key entry with a wrong value is still missing for that file', () => {
    const r = verifyReadWitness([deferredA], { read_witness: { 'whatever': 'deadbeefdead' } })
    expect(r.ok).toBe(false)
    expect(r.missing).toEqual(['A.md'])
  })

  it('the instruction states the key is the path and the value the prefix, with a literal example', () => {
    const text = contextWitnessInstruction([deferredA])
    expect(text).toMatch(/"A\.md": "<first 12 hex chars/)
    expect(text).toMatch(/key is the file path exactly as written/i)
  })

  it('flags a missing read_witness field on the parsed object', () => {
    const result = verifyReadWitness([deferredA], {})
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['A.md'])
    expect(result.mismatched).toEqual([])
  })

  it('flags a missing entry for one deferred path while another is present', () => {
    const result = verifyReadWitness([deferredA, deferredB], { read_witness: { 'A.md': 'abcdef123456' } })
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['B.md'])
  })

  it('flags a wrong hash as mismatched, not missing', () => {
    const result = verifyReadWitness([deferredA], { read_witness: { 'A.md': '000000000000' } })
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([])
    expect(result.mismatched).toEqual(['A.md'])
  })

  it('treats a non-object parsed value as if no witness were provided', () => {
    expect(verifyReadWitness([deferredA], null).ok).toBe(false)
    expect(verifyReadWitness([deferredA], 'not json').ok).toBe(false)
    expect(verifyReadWitness([deferredA], undefined).ok).toBe(false)
    expect(verifyReadWitness([deferredA], []).ok).toBe(false)
  })

  it('treats a too-short but correct witness value as tooShort, and a too-short wrong one as missing', () => {
    const result = verifyReadWitness([deferredA], { read_witness: { 'A.md': 'abc' } })
    expect(result.tooShort).toEqual(['A.md'])
    expect(result.missing).toEqual([])
    expect(result.mismatched).toEqual([])
    const wrong = verifyReadWitness([deferredA], { read_witness: { 'A.md': 'zzz' } })
    expect(wrong.missing).toEqual(['A.md'])
  })
})

describe('assertReadWitness', () => {
  const deferredA: ContextFile = { path: 'A.md', exists: true, inlined: false, bytes: 100, sha: 'abcdef123456789012345678901234567890abcd', content: null }

  it('does not throw when the witness matches', () => {
    expect(() => assertReadWitness([deferredA], { read_witness: { 'A.md': 'abcdef123456' } })).not.toThrow()
  })

  it('throws a named context_read_unverified error naming the path and expected/got hash on mismatch', () => {
    expect(() => assertReadWitness([deferredA], { read_witness: { 'A.md': '000000000000' } }))
      .toThrow(/context_read_unverified: A\.md — agent did not evidence reading the deferred file \(expected blob abcdef123456789012345678901234567890abcd, got 000000000000\)/)
  })

  it('throws naming "missing" when the field is absent entirely', () => {
    expect(() => assertReadWitness([deferredA], {})).toThrow(/context_read_unverified: A\.md .*got missing/)
  })
})

// FLOW.md open gap 2, array-contract consumers: decompose-tasks returns a
// bare JSON array (its tasks.json contract), which has no slot for a
// read_witness. The wrap instruction asks for {read_witness, <key>: [...]}
// only when something is deferred, and unwrapWitnessedArray accepts both
// shapes so the array contract on disk is unchanged.
describe('contextWitnessWrapInstruction', () => {
  const inlined: ContextFile = { path: 'A.md', exists: true, inlined: true, bytes: 5, sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', content: 'hello' }
  const deferred: ContextFile = { path: 'docs/epics/x/SPEC.md', exists: true, inlined: false, bytes: 31133, sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', content: null }

  it('is empty when nothing is deferred — the bare-array prompt stays byte-identical', () => {
    expect(contextWitnessWrapInstruction([inlined], 'tasks')).toBe('')
    expect(contextWitnessWrapInstruction([], 'tasks')).toBe('')
  })

  it('carries the plain witness instruction plus a wrap-as-object instruction naming the array key', () => {
    const instruction = contextWitnessWrapInstruction([deferred], 'tasks')
    expect(instruction).toContain(contextWitnessInstruction([deferred]))
    expect(instruction).toContain('"read_witness"')
    expect(instruction).toContain('"tasks"')
    expect(instruction).toMatch(/single JSON object/)
  })
})

describe('unwrapWitnessedArray', () => {
  it('returns a bare array unchanged', () => {
    const arr = [{ id: 'task-001' }]
    expect(unwrapWitnessedArray(arr, 'tasks')).toBe(arr)
  })

  it('returns the keyed array from a wrapped object', () => {
    const arr = [{ id: 'task-001' }]
    expect(unwrapWitnessedArray({ read_witness: { 'A.md': 'abcdef123456' }, tasks: arr }, 'tasks')).toBe(arr)
  })

  it('returns null for anything else — an object without the key, a non-array value, a string', () => {
    expect(unwrapWitnessedArray({ read_witness: {} }, 'tasks')).toBeNull()
    expect(unwrapWitnessedArray({ tasks: 'nope' }, 'tasks')).toBeNull()
    expect(unwrapWitnessedArray('[]', 'tasks')).toBeNull()
    expect(unwrapWitnessedArray(null, 'tasks')).toBeNull()
  })
})

describe('end-to-end under real bash', () => {
  it('probes, plans and inlines only the small file; the large one is deferred with its real size and hash', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-relay-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: dir })
      writeFileSync(join(dir, 'small.md'), 'héllo\n')
      writeFileSync(join(dir, 'big.md'), 'x'.repeat(CONTEXT_RELAY_BUDGET_BYTES + 10))
      const files = ['small.md', 'big.md', 'absent.md']
      const probeSteps = contextProbeSteps({ files })
      const probe = parseBatchResult(execFileSync('bash', ['-c', batchScript(probeSteps)], { cwd: dir, encoding: 'utf8' }), probeSteps)
      const plan = contextRelayPlan(probe, files)
      expect(plan.inline).toEqual(['small.md'])
      expect(plan.deferred).toEqual(['big.md'])
      expect(plan.missing).toEqual(['absent.md'])
      const inlineSteps = contextInlineSteps(plan.inline)
      const inline = parseBatchResult(execFileSync('bash', ['-c', batchScript(inlineSteps)], { cwd: dir, encoding: 'utf8' }), inlineSteps)
      const ctx = contextFromRelay(probe, inline, plan)
      expect(ctx.files['small.md'].content).toBe('héllo\n')
      expect(ctx.files['small.md'].bytes).toBe(7)
      expect(ctx.files['big.md'].bytes).toBe(CONTEXT_RELAY_BUDGET_BYTES + 10)
      expect(ctx.files['big.md'].sha).toMatch(/^[0-9a-f]{40}$/)
      expect(ctx.files['absent.md'].exists).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})


// A witness the prompt itself prints is no witness: the agent could copy the
// blob-sha prefix out of its own prompt without opening the file.
describe('the deferred-file prompt never prints the blob sha the witness must reproduce', () => {
  const f: ContextFile = { path: 'docs/SPEC.md', exists: true, inlined: false, bytes: 4096, sha: 'abcdef0123456789abcdef0123456789abcdef01', content: null }
  it('contextSlot names path and bytes only', () => {
    const slot = contextSlot(f)
    expect(slot).toContain('docs/SPEC.md')
    expect(slot).toContain('4096 bytes')
    expect(slot).not.toContain('abcdef012345')
  })
  it('contextWitnessInstruction tells the agent to compute the hash, without printing it', () => {
    expect(contextWitnessInstruction([f])).not.toContain('abcdef012345')
  })
})
