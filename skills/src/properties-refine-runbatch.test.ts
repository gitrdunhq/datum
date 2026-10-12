// DAT-8 RED: datum-properties and datum-refine re-fetch a mismatched inline
// context relay through runBatch (with the CONTEXT_INLINE_RETRY_MARKER
// option) instead of an agent() call built from contextInlineRetryPrompt.
// The workflow scripts cannot be executed under vitest, so the call shapes
// are read from the source text with comments stripped, so prose cannot
// satisfy or break a pin.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const FILES = ['datum-properties.ts', 'datum-refine.ts'] as const
const TEST_FILES = ['datum-properties.test.ts', 'datum-refine.test.ts'] as const

const read = (name: string) => readFileSync(join(__dirname, name), 'utf8')
const sources = Object.fromEntries(FILES.map((f) => [f, stripComments(read(f))])) as Record<(typeof FILES)[number], string>

const RETRY_CALL =
  /await runBatch\(inlineSteps, stageOpts\('cli', \{ label: 'read-context-files:retry', model: model\('fast'\), retryMarker: CONTEXT_INLINE_RETRY_MARKER \}\)\)/

describe('DAT-8 — properties and refine retry the inline relay through runBatch', () => {
  it('AC1: no contextInlineRetryPrompt( call and no import of it', () => {
    for (const f of FILES) {
      const src = sources[f]
      expect(src, `${f} has no contextInlineRetryPrompt( call`).not.toMatch(/contextInlineRetryPrompt\s*\(/)
      expect(src, `${f} does not mention contextInlineRetryPrompt`).not.toContain('contextInlineRetryPrompt')
      const importLine = src.split('\n').find((l) => /^import .* from '\.\/shared\/context-relay'/.test(l)) ?? ''
      expect(importLine, `${f} context-relay import`).not.toMatch(/contextInlineRetryPrompt/)
      expect(importLine, `${f} imports the marker`).toMatch(/\bCONTEXT_INLINE_RETRY_MARKER\b/)
    }
  })

  it('AC2: runBatch(inlineSteps, stageOpts(...)) with the retry label, fast model and marker, still merged with mergeRelayRetry', () => {
    for (const f of FILES) {
      const src = sources[f]
      expect(src, `${f} retry call shape`).toMatch(RETRY_CALL)
      const retryIdx = src.indexOf("label: 'read-context-files:retry'")
      expect(retryIdx).toBeGreaterThan(-1)
      const callIdx = src.lastIndexOf('runBatch(', retryIdx)
      expect(callIdx, `${f}: a runBatch( call owns the retry label`).toBeGreaterThan(-1)
      expect(src.slice(callIdx, retryIdx), `${f}: the retry is not an agent() call`).not.toMatch(/\bagent\(/)
      expect(src, `${f} still merges the retry`).toMatch(/ctx = mergeRelayRetry\(ctx, contextFromRelay\(readBatch, retryBatch, relayPlan\)\)/)
    }
  })

  it('AC3: the existing pins in the two test files assert the new form', () => {
    for (const t of TEST_FILES) {
      const text = read(t)
      const start = text.indexOf("describe('a mismatched inline relay is re-fetched once, then deferred'")
      expect(start, `${t} keeps the retry describe block`).toBeGreaterThan(-1)
      const end = text.indexOf('\n})', start)
      const block = text.slice(start, end)
      expect(block, `${t} pin asserts a runBatch( call`).toMatch(/toMatch\(\/runBatch\\\(/)
      expect(block, `${t} pin names the marker`).toContain('CONTEXT_INLINE_RETRY_MARKER')
      expect(block, `${t} pin asserts contextInlineRetryPrompt( is absent`).toMatch(
        /expect\(src\)\.not\.toMatch\(\/contextInlineRetryPrompt\\\(\/\)/,
      )
      expect(block, `${t} pin no longer requires contextInlineRetryPrompt(`).not.toMatch(
        /expect\(src\)\.toMatch\(\/contextInlineRetryPrompt/,
      )
    }
  })

  it('AC4: npx tsc -p skills/tsconfig.json exits 0', () => {
    const repoRoot = resolve(__dirname, '..', '..')
    const r = spawnSync('npx', ['tsc', '-p', 'skills/tsconfig.json'], { cwd: repoRoot, encoding: 'utf8', timeout: 60_000 })
    expect(r.error, 'tsc ran within the timeout').toBeUndefined()
    expect(r.status, `tsc output: ${r.stdout}${r.stderr}`).toBe(0)
  }, 90_000)
})
