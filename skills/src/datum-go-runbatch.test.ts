// DAT-4 RED: datum-go's act-start dispatch and the two preflight checks go
// through runBatch instead of the agent()-based batchCommandPrompt /
// runCommandPrompt prompts. Source-pin tests (the lane spec calls for them):
// the workflow script cannot be executed under vitest, so the call shapes are
// read from the source text, with comments stripped so prose cannot satisfy
// or break a pin.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const goSrc = stripComments(readFileSync(join(__dirname, 'datum-go.ts'), 'utf8'))
const awakeSrc = stripComments(readFileSync(join(__dirname, 'datum-awake.ts'), 'utf8'))

/** Text of the runBatch call whose options carry the given stage label. */
function runBatchCallFor(label: string): string {
  const labelIdx = goSrc.indexOf(`label: '${label}'`)
  expect(labelIdx, `label '${label}' present in datum-go.ts`).toBeGreaterThan(-1)
  const callIdx = goSrc.lastIndexOf('runBatch(', labelIdx)
  expect(callIdx, `a runBatch( call precedes label '${label}'`).toBeGreaterThan(-1)
  // The call must be the one that owns the label, not an earlier call.
  const between = goSrc.slice(callIdx, labelIdx)
  expect(between).not.toMatch(/\bawait agent\(/)
  return goSrc.slice(callIdx, labelIdx + label.length + 20)
}

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length
}

describe('DAT-4 — datum-go.ts drops the prompt-based batch helpers', () => {
  it('has no batchCommandPrompt( call and no runCommandPrompt( call', () => {
    expect(goSrc).not.toMatch(/\bbatchCommandPrompt\s*\(/)
    expect(goSrc).not.toMatch(/\brunCommandPrompt\s*\(/)
  })

  it('imports neither batchCommandPrompt nor runCommandPrompt', () => {
    const importLines = goSrc.split('\n').filter((l) => /^\s*import\b/.test(l))
    const imported = importLines.join('\n')
    expect(imported).not.toMatch(/\bbatchCommandPrompt\b/)
    expect(imported).not.toMatch(/\brunCommandPrompt\b/)
  })
})

describe('DAT-4 — act-start dispatch', () => {
  it('dispatches act-start with runBatch(actStart, ...) and keeps the act-start label', () => {
    expect(goSrc).toMatch(/runBatch\(\s*actStart\s*,/)
    const call = runBatchCallFor('act-start')
    expect(call).toMatch(/^runBatch\(\s*actStart\s*,/)
    expect(call).toContain("label: 'act-start'")
  })
})

describe('DAT-4 — preflight checks are runBatch over one-element BatchStep arrays', () => {
  it('preflight-tool-check is a runBatch call with exactly one step running preflight-tool-check.sh', () => {
    const call = runBatchCallFor('preflight-tool-check')
    expect(countMatches(call, /\bcommand\s*:/g)).toBe(1)
    expect(countMatches(call, /\bname\s*:/g)).toBeGreaterThanOrEqual(1)
    expect(call).toContain('scripts/preflight-tool-check.sh')
    // The same non-datum-repo fallback command string as before.
    expect(call).toContain('skipping self-hosted install check')
  })

  it('preflight-gitignore is a runBatch call with exactly one step running datum gitignore-check (--fix under yolo)', () => {
    const call = runBatchCallFor('preflight-gitignore')
    expect(countMatches(call, /\bcommand\s*:/g)).toBe(1)
    expect(call).toContain("datum gitignore-check${yolo ? ' --fix' : ''}")
  })
})

describe('DAT-4 — a failing preflight step still halts with the same messages', () => {
  it('checks the preflight step exit_code and keeps both halt messages', () => {
    const toolIdx = goSrc.indexOf("label: 'preflight-tool-check'")
    const gitignoreIdx = goSrc.indexOf("label: 'preflight-gitignore'")
    const sectionEnd = goSrc.indexOf('// Auto-resume')
    expect(toolIdx).toBeGreaterThan(-1)
    expect(gitignoreIdx).toBeGreaterThan(toolIdx)
    const section = goSrc.slice(toolIdx, sectionEnd > -1 ? sectionEnd : undefined)
    // A non-zero exit_code on a preflight step is inspected, not ignored.
    expect(section).toMatch(/exit_code\s*(!==?|>)\s*0/)
    // Halt messages are unchanged.
    expect(section).toContain('datum CLI tool install is stale/misdirected (#327)')
    expect(section).toContain(".gitignore does not ignore datum's scratch paths")
    expect(section).toContain("parseAgentJsonStrict(")
    expect(section).toContain("'preflight-tool-check'")
    expect(section).toContain("'preflight-gitignore'")
  })
})

describe('DAT-4 — batch root and cache key are set before the first runBatch call', () => {
  it('setBatchCacheKey( and setBatchRoot( both precede the first runBatch(', () => {
    const firstRunBatch = goSrc.indexOf('runBatch(')
    const firstRoot = goSrc.indexOf('setBatchRoot(')
    const firstKey = goSrc.indexOf('setBatchCacheKey(')
    expect(firstRunBatch).toBeGreaterThan(-1)
    expect(firstRoot).toBeGreaterThan(-1)
    expect(firstKey).toBeGreaterThan(-1)
    expect(firstRoot).toBeLessThan(firstRunBatch)
    expect(firstKey).toBeLessThan(firstRunBatch)
  })
})

describe('DAT-4 — datum-awake.ts no longer imports batchCommandPrompt', () => {
  it('does not import or call batchCommandPrompt', () => {
    const imported = awakeSrc.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n')
    expect(imported).not.toMatch(/\bbatchCommandPrompt\b/)
    expect(awakeSrc).not.toMatch(/\bbatchCommandPrompt\s*\(/)
  })
})
