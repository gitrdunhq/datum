// The datum-tdd-act entry bundles (act, setup, merge) and the docs bundle must
// send their datum-cli batches through runBatch (shared/agents), not through a
// hand-rolled agent(batchCommandPrompt(...)) call, so the shell path, the
// large-batch routing and the retry logic apply to them as well.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function readSource(name: string): string {
  const raw = readFileSync(join(__dirname, name), 'utf8')
  // Drop comments so prose that mentions a symbol cannot satisfy or break an assertion.
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '')
}

const act = readSource('datum-tdd-act.ts')
const setup = readSource('datum-tdd-act-setup.ts')
const merge = readSource('datum-tdd-act-merge.ts')
const docs = readSource('datum-tdd-act-docs.ts')

const bundles: Array<[string, string]> = [
  ['datum-tdd-act.ts', act],
  ['datum-tdd-act-setup.ts', setup],
  ['datum-tdd-act-merge.ts', merge],
]

/** The text of the runBatch call that starts with `head`, up to 400 chars. */
function callAfter(src: string, head: string): string {
  const at = src.indexOf(head)
  return at < 0 ? '' : src.slice(at, at + 400)
}

describe('act entry bundles — datum-cli calls go through runBatch', () => {
  for (const [name, src] of bundles) {
    it(`${name} has no batchCommandPrompt call and no batchCommandPrompt import`, () => {
      expect(src.includes('batchCommandPrompt(')).toBe(false)
      expect(src).not.toMatch(/import\s*\{[^}]*\bbatchCommandPrompt\b[^}]*\}/)
      expect(src.includes('batchCommandPrompt')).toBe(false)
    })
  }

  it('datum-tdd-act.ts dispatches runBatch(actStart with the act-start label', () => {
    const call = callAfter(act, 'runBatch(actStart')
    expect(call).not.toBe('')
    expect(call).toMatch(/label:\s*'act-start'/)
    expect(act).toMatch(/import\s*\{[^}]*\brunBatch\b[^}]*\}\s*from\s*'\.\/shared\/agents'/)
  })

  it('datum-tdd-act-setup.ts dispatches runBatch(steps with the setup label', () => {
    const call = callAfter(setup, 'runBatch(steps')
    expect(call).not.toBe('')
    expect(call).toMatch(/label:\s*`setup\$\{a\.batchTag\}`/)
    expect(setup).toMatch(/import\s*\{[^}]*\brunBatch\b[^}]*\}\s*from\s*'\.\/shared\/agents'/)
  })

  it('datum-tdd-act-merge.ts dispatches runBatch(steps with the merge label', () => {
    const call = callAfter(merge, 'runBatch(steps')
    expect(call).not.toBe('')
    expect(call).toMatch(/label:\s*`merge\$\{a\.batchTag\}`/)
    expect(merge).toMatch(/import\s*\{[^}]*\brunBatch\b[^}]*\}\s*from\s*'\.\/shared\/agents'/)
  })

  for (const [name, src] of bundles) {
    it(`${name} sets the batch cache key and root before the first runBatch call`, () => {
      const first = src.indexOf('runBatch(')
      const key = src.indexOf('setBatchCacheKey(')
      const root = src.indexOf('setBatchRoot(')
      expect(first).toBeGreaterThan(-1)
      expect(key).toBeGreaterThan(-1)
      expect(root).toBeGreaterThan(-1)
      expect(key).toBeLessThan(first)
      expect(root).toBeLessThan(first)
    })
  }
})

describe('datum-tdd-act-docs.ts — no batchCommandPrompt import', () => {
  it('does not import batchCommandPrompt', () => {
    expect(docs).not.toMatch(/import\s*\{[^}]*\bbatchCommandPrompt\b[^}]*\}/)
    expect(docs.includes('batchCommandPrompt')).toBe(false)
  })

  it('still dispatches its commit through runBatch', () => {
    expect(docs.includes('runBatch(commitStepList')).toBe(true)
  })
})
