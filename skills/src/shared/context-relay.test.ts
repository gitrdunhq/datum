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
  CONTEXT_CHUNK_BYTES,
  contextProbeSteps,
  contextRelayPlan,
  contextInlineSteps,
  contextFromRelay,
  contextSlot,
  contextWitnessInstruction,
  verifyReadWitness,
  assertReadWitness,
  contextChunkPlan,
  contextChunkSteps,
  contextAssembleChunks,
  type ContextFile,
} from './context-relay'
import { base64Encode } from './base64'

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
  it('cats + wc -c only the inline subset, indexed by position in that subset', () => {
    const steps = contextInlineSteps(['A.md', 'C.md'])
    expect(names(steps)).toEqual(['ctx-cat-0', 'ctx-wc-0', 'ctx-cat-1', 'ctx-wc-1'])
    expect(steps[2].command).toContain('C.md')
    expect(steps.every((s) => s.tolerant)).toBe(true)
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

  it('is a mandatory Read instruction naming path, bytes and sha for a deferred file', () => {
    const slot = contextSlot({ path: 'docs/epics/datum/x/SPEC.md', exists: true, inlined: false, bytes: 31133, sha: 'bbb', content: null })
    expect(slot).toContain('docs/epics/datum/x/SPEC.md')
    expect(slot).toContain('31133')
    expect(slot).toContain('bbb')
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
    expect(result).toEqual({ ok: true, missing: [], mismatched: [] })
  })

  it('does not require a witness entry for an inlined file', () => {
    const result = verifyReadWitness([inlined], {})
    expect(result.ok).toBe(true)
  })

  it('accepts any prefix of at least 12 hex chars, not just an exact-length match', () => {
    const result = verifyReadWitness([deferredA], { read_witness: { 'A.md': 'abcdef123456789012' } })
    expect(result.ok).toBe(true)
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

  it('treats a too-short witness value as missing, not a mismatch', () => {
    const result = verifyReadWitness([deferredA], { read_witness: { 'A.md': 'abc' } })
    expect(result.missing).toEqual(['A.md'])
    expect(result.mismatched).toEqual([])
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

describe('contextChunkPlan', () => {
  it('splits an exact multiple of the budget into equal chunks with no zero-length remainder', () => {
    const plan = contextChunkPlan(32768, 16384)
    expect(plan).toEqual([{ offset: 0, length: 16384 }, { offset: 16384, length: 16384 }])
  })

  it('leaves a final, shorter chunk for a remainder', () => {
    const plan = contextChunkPlan(40000, 16384)
    expect(plan).toEqual([
      { offset: 0, length: 16384 },
      { offset: 16384, length: 16384 },
      { offset: 32768, length: 7232 },
    ])
  })

  it('a file smaller than the budget is a single chunk covering the whole file', () => {
    expect(contextChunkPlan(500, 16384)).toEqual([{ offset: 0, length: 500 }])
  })

  it('defaults to CONTEXT_CHUNK_BYTES (12 KB raw → 16 KB base64 on stdout, under the spill threshold)', () => {
    expect(CONTEXT_CHUNK_BYTES).toBe(12 * 1024)
    expect(Math.ceil((CONTEXT_CHUNK_BYTES * 4) / 3)).toBeLessThanOrEqual(CONTEXT_RELAY_BUDGET_BYTES)
    const plan = contextChunkPlan(CONTEXT_CHUNK_BYTES + 1)
    expect(plan).toEqual([
      { offset: 0, length: CONTEXT_CHUNK_BYTES },
      { offset: CONTEXT_CHUNK_BYTES, length: 1 },
    ])
  })

  it('a zero or negative byte count is a single empty chunk, not an error', () => {
    expect(contextChunkPlan(0)).toEqual([{ offset: 0, length: 0 }])
    expect(contextChunkPlan(-1)).toEqual([{ offset: 0, length: 0 }])
  })
})

describe('contextChunkSteps', () => {
  it('emits a base64 payload step and a wc -c witness step over the same tail|head window', () => {
    const steps = contextChunkSteps('docs/epics/x/lane-plan.json', { offset: 16384, length: 100 }, 2)
    expect(names(steps)).toEqual(['ctx-chunk-2', 'ctx-chunk-wc-2'])
    expect(steps.every((s) => s.tolerant)).toBe(true)
    expect(steps[0].command).toContain('tail -c +16385')
    expect(steps[0].command).toContain('head -c 100')
    expect(steps[0].command).toContain('| base64')
    expect(steps[1].command).toContain('tail -c +16385')
    expect(steps[1].command).toContain('head -c 100')
    expect(steps[1].command).toContain('wc -c')
    expect(steps[1].command).not.toContain('base64')
  })
})

describe('contextAssembleChunks', () => {
  function chunkResult(i: number, text: string): BatchResult {
    const bytes = Array.from(Buffer.from(text, 'utf8'))
    return fake({ [`ctx-chunk-${i}`]: base64Encode(bytes), [`ctx-chunk-wc-${i}`]: String(bytes.length) })
  }

  it('assembles chunks in order, decoding base64 and verifying every byte count', () => {
    const plan = [{ offset: 0, length: 5 }, { offset: 5, length: 6 }]
    const results = [chunkResult(0, 'hello'), chunkResult(1, ' world')]
    const out = contextAssembleChunks('SPEC.md', 11, 'deadbeef', results, plan)
    expect(out).toBe('hello world')
  })

  it('reassembles a chunk boundary that splits a multibyte character (§4) without corrupting it', () => {
    const text = 'acceptance criteria: §4 applies'
    const bytes = Array.from(Buffer.from(text, 'utf8'))
    const splitAt = bytes.indexOf(0xc2) + 1 // splits the 2-byte § sequence in half
    const chunkABytes = bytes.slice(0, splitAt)
    const chunkBBytes = bytes.slice(splitAt)
    const plan = [{ offset: 0, length: chunkABytes.length }, { offset: chunkABytes.length, length: chunkBBytes.length }]
    const results = [
      fake({ 'ctx-chunk-0': base64Encode(chunkABytes), 'ctx-chunk-wc-0': String(chunkABytes.length) }),
      fake({ 'ctx-chunk-1': base64Encode(chunkBBytes), 'ctx-chunk-wc-1': String(chunkBBytes.length) }),
    ]
    const out = contextAssembleChunks('SPEC.md', bytes.length, 'deadbeef', results, plan)
    expect(out).toBe(text)
  })

  it('accepts chunk results spread across several BatchResult objects (one agent() call per chunk)', () => {
    const plan = [{ offset: 0, length: 3 }, { offset: 3, length: 3 }]
    const results = [chunkResult(0, 'abc'), chunkResult(1, 'def')]
    expect(contextAssembleChunks('X.json', 6, 's', results, plan)).toBe('abcdef')
  })

  it('throws context_relay_mismatch naming the path and chunk index when a chunk is missing', () => {
    const plan = [{ offset: 0, length: 5 }]
    expect(() => contextAssembleChunks('SPEC.md', 5, 's', [], plan)).toThrow(/context_relay_mismatch: SPEC\.md chunk 0/)
  })

  it('throws when a chunk\'s decoded bytes disagree with its own wc -c witness (tampered stdout)', () => {
    const plan = [{ offset: 0, length: 5 }]
    const tampered = [fake({ 'ctx-chunk-0': base64Encode(Array.from(Buffer.from('hello'))), 'ctx-chunk-wc-0': '4' })]
    expect(() => contextAssembleChunks('SPEC.md', 5, 's', tampered, plan)).toThrow(/context_relay_mismatch: SPEC\.md chunk 0 expected 4 bytes/)
  })

  it('throws when a chunk decodes to more/fewer bytes than its planned length', () => {
    const plan = [{ offset: 0, length: 999 }]
    const wrong = [fake({ 'ctx-chunk-0': base64Encode(Array.from(Buffer.from('hello'))), 'ctx-chunk-wc-0': '5' })]
    expect(() => contextAssembleChunks('SPEC.md', 5, 's', wrong, plan)).toThrow(/context_relay_mismatch: SPEC\.md chunk 0 expected planned length 999/)
  })

  it('throws a total mismatch when every chunk verifies individually but the sum disagrees with the probe', () => {
    const plan = [{ offset: 0, length: 5 }]
    const results = [chunkResult(0, 'hello')]
    expect(() => contextAssembleChunks('SPEC.md', 999, 's', results, plan)).toThrow(/context_relay_mismatch: SPEC\.md total expected 999 bytes, got 5 bytes/)
  })

  it('throws on invalid base64 rather than assembling garbage', () => {
    const plan = [{ offset: 0, length: 5 }]
    const bad = [fake({ 'ctx-chunk-0': '!!!not-base64!!!', 'ctx-chunk-wc-0': '5' })]
    expect(() => contextAssembleChunks('SPEC.md', 5, 's', bad, plan)).toThrow(/context_relay_mismatch: SPEC\.md chunk 0 was not valid base64/)
  })
})

describe('CHUNKED mode end-to-end under real bash', () => {
  it('a 40 KB JSON file with multibyte (§4-style) text round-trips byte-for-byte through tail|head|base64 chunks and JSON.parses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-chunk-'))
    try {
      const acceptance = 'acceptance_criteria §4, §12, naïve café 日本語 😀 '
      const lanes: Record<string, { acceptance_criteria: string; pad: string }> = {}
      for (let i = 0; i < 400; i++) {
        lanes[`task-${i}`] = { acceptance_criteria: acceptance, pad: 'x'.repeat(80) }
      }
      const content = JSON.stringify({ lanes, topological_order: Object.keys(lanes), total_lanes: 400 })
      writeFileSync(join(dir, 'lane-plan.json'), content, 'utf8')
      const bytes = Buffer.byteLength(content, 'utf8')
      expect(bytes).toBeGreaterThan(40 * 1024)

      const plan = contextChunkPlan(bytes, CONTEXT_RELAY_BUDGET_BYTES)
      expect(plan.length).toBeGreaterThan(1)
      const results = plan.map((chunk, i) => {
        const steps = contextChunkSteps('lane-plan.json', chunk, i)
        return parseBatchResult(execFileSync('bash', ['-c', batchScript(steps)], { cwd: dir, encoding: 'utf8' }), steps)
      })
      const assembled = contextAssembleChunks('lane-plan.json', bytes, 'irrelevant-for-this-check', results, plan)
      expect(assembled).toBe(content)
      const parsed = JSON.parse(assembled)
      expect(parsed.total_lanes).toBe(400)
      expect(parsed.lanes['task-0'].acceptance_criteria).toBe(acceptance)

      // Tamper with one chunk's stdout the way a normalising runner would —
      // must throw, never silently assemble the corrupted version.
      const tamperedResults = results.map((r, i) => (i === 0 ? { ...r, steps: r.steps.map((s) => (s.name === 'ctx-chunk-0' ? { ...s, stdout: base64Encode([1, 2, 3]) } : s)) } : r))
      expect(() => contextAssembleChunks('lane-plan.json', bytes, 'irrelevant-for-this-check', tamperedResults, plan)).toThrow(/context_relay_mismatch/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
