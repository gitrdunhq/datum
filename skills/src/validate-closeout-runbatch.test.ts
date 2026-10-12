// DAT-6 RED: datum-validate's verify batch and datum-closeout's collect and
// archive batches go through runBatch instead of the agent()-based
// batchCommandPrompt prompt, and datum-review drops its dead
// batchCommandPrompt import. Source-pin tests: the workflow scripts cannot be
// executed under vitest, so call shapes are read from the source text, with
// comments stripped so prose cannot satisfy or break a pin.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const read = (name: string) => stripComments(readFileSync(join(__dirname, name), 'utf8'))
const validateSrc = read('datum-validate.ts')
const closeoutSrc = read('datum-closeout.ts')
const reviewSrc = read('datum-review.ts')

function importBlock(src: string): string {
  return src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')
}

/** Text of the runBatch(<first>, ...) call through its options' label. */
function callWithLabel(src: string, first: string, label: string): string {
  const callIdx = src.indexOf(`runBatch(${first}`)
  expect(callIdx, `runBatch(${first} present`).toBeGreaterThan(-1)
  const labelIdx = src.indexOf(`label: '${label}'`, callIdx)
  expect(labelIdx, `label '${label}' follows runBatch(${first}`).toBeGreaterThan(-1)
  expect(labelIdx - callIdx).toBeLessThan(200)
  return src.slice(callIdx, labelIdx + label.length + 10)
}

describe('DAT-6 — datum-validate.ts verify batch', () => {
  it('calls runBatch(verifySteps, ...)', () => {
    expect(validateSrc).toMatch(/runBatch\(\s*verifySteps\s*,/)
  })

  it('has no batchCommandPrompt( call and does not import batchCommandPrompt', () => {
    expect(validateSrc).not.toMatch(/\bbatchCommandPrompt\s*\(/)
    expect(importBlock(validateSrc)).not.toMatch(/\bbatchCommandPrompt\b/)
  })

  it('keeps the validate-verify label and the cli stage options on the runBatch call', () => {
    const call = callWithLabel(validateSrc, 'verifySteps', 'validate-verify')
    expect(call).toMatch(/stageOpts\(\s*'cli'/)
  })
})

describe('DAT-6 — datum-closeout.ts collect and archive batches', () => {
  it('calls runBatch(collectSteps, ...) with the closeout-collect label', () => {
    expect(closeoutSrc).toMatch(/runBatch\(\s*collectSteps\s*,/)
    const call = callWithLabel(closeoutSrc, 'collectSteps', 'closeout-collect')
    expect(call).toMatch(/bootstrapOpts\(\s*'cli'/)
  })

  it('calls runBatch(archiveSteps, ...) with the closeout-archive label', () => {
    expect(closeoutSrc).toMatch(/runBatch\(\s*archiveSteps\s*,/)
    const call = callWithLabel(closeoutSrc, 'archiveSteps', 'closeout-archive')
    expect(call).toMatch(/stageOpts\(\s*'cli'/)
  })

  it('has no batchCommandPrompt( call and does not import batchCommandPrompt', () => {
    expect(closeoutSrc).not.toMatch(/\bbatchCommandPrompt\s*\(/)
    expect(importBlock(closeoutSrc)).not.toMatch(/\bbatchCommandPrompt\b/)
  })
})

describe('DAT-6 — datum-review.ts', () => {
  it('no longer imports batchCommandPrompt', () => {
    expect(importBlock(reviewSrc)).not.toMatch(/\bbatchCommandPrompt\b/)
  })

  it('has no batchCommandPrompt( call', () => {
    expect(reviewSrc).not.toMatch(/\bbatchCommandPrompt\s*\(/)
  })
})
