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
} from './context-relay'

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
