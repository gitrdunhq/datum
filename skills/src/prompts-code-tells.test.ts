// randommonicle/claude-skills `unslop-code`, adopted for the REFACTOR stage.
// The verified data ranks the substance tells (tutorial shape 18.6%,
// over-engineering 7.8%, repo mismatch 3.5%) far above cosmetics, and
// clears debug logging and defensive validation as tells to flag. The
// REFACTOR check (a detector) reads for substance; the REFACTOR agent (a
// generator) carries the over-correction fence; the scanner handles the
// mechanical surface tells. reflect.md is left alone: slop in tests shows
// up as weak assertions, which its rubric already punishes.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const check = readFileSync(join(__dirname, 'prompts', 'refactor-check.md'), 'utf8')
const refactor = readFileSync(join(__dirname, 'prompts', 'refactor.md'), 'utf8')
const agentDef = readFileSync(join(__dirname, '..', '..', 'agents', 'datum-refactor.md'), 'utf8')

describe('refactor-check.md reads for the substance tells and does not chase the cleared ones', () => {
  it('names tutorial shape, one-caller abstraction, repo mismatch and narrating comments as triggers', () => {
    expect(check).toMatch(/tutorial/i)
    expect(check).toMatch(/one caller|single caller/i)
    expect(check).toMatch(/surrounding|neighbou?ring/i)
    expect(check).toMatch(/narrat/i)
    expect(check).toMatch(/generic name|process_data/i)
  })
  it('tells the checker not to flag defensive checks or logging', () => {
    expect(check).toMatch(/defensive/i)
    expect(check).toMatch(/logging|log lines/i)
  })
  it('accepts the scanner findings slot', () => {
    expect(check).toContain('{{tellsSlot}}')
  })
})

describe('refactor.md removes tells and carries the over-correction fence', () => {
  it('scopes REFACTOR to removing tells and passes the scanner findings', () => {
    expect(refactor).toContain('{{tellsSlot}}')
    expect(refactor).toMatch(/narrat/i)
    expect(refactor).toMatch(/one caller|single caller/i)
  })
  it('anchors on the level the surrounding code operates at', () => {
    expect(refactor).toMatch(/level (the )?(surrounding|neighbou?ring) code/i)
    expect(refactor).toMatch(/do not add a (check|comment|type|layer)/i)
  })
})

describe('agents/datum-refactor.md carries the same fence', () => {
  it('names the over-correction trap', () => {
    expect(agentDef).toMatch(/surrounding|neighbou?ring/i)
    expect(agentDef).toMatch(/one caller|single caller/i)
  })
})
