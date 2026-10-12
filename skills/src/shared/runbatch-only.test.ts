// DAT-9 — repo-wide guard: every batch goes through runBatch, so the raw
// prompt builders live only where they are implemented or wrapped.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const srcRoot = join(__dirname, '..')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const files = walk(srcRoot).map((f) => ({
  rel: relative(srcRoot, f).split(sep).join('/'),
  text: readFileSync(f, 'utf8'),
}))

function filesMentioning(symbol: string): string[] {
  return files.filter((f) => f.text.includes(symbol)).map((f) => f.rel).sort()
}

describe('prompt builders are confined to their owning modules', () => {
  it('scans a non-trivial set of sources', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.map((f) => f.rel)).toContain('shared/batch.ts')
  })

  it('batchCommandPrompt appears only in shared/batch.ts and shared/agents.ts', () => {
    expect(filesMentioning('batchCommandPrompt')).toEqual(['shared/agents.ts', 'shared/batch.ts'])
  })

  it('runCommandPrompt appears only in shared/boot.ts', () => {
    // allowed set: boot.ts, context-relay.ts, agents.ts; today only boot.ts defines it
    const found = filesMentioning('runCommandPrompt')
    expect(found).toContain('shared/boot.ts')
    for (const f of found) expect(['shared/agents.ts', 'shared/boot.ts', 'shared/context-relay.ts']).toContain(f)
  })

  it('contextInlineRetryPrompt appears in no non-test source', () => {
    expect(filesMentioning('contextInlineRetryPrompt')).toEqual([])
  })

  it('context-relay.ts still exports CONTEXT_INLINE_RETRY_MARKER', () => {
    const relay = files.find((f) => f.rel === 'shared/context-relay.ts')
    expect(relay?.text).toMatch(/export const CONTEXT_INLINE_RETRY_MARKER\b/)
  })

  it('tracker.ts does not import batchCommandPrompt', () => {
    const tracker = files.find((f) => f.rel === 'shared/tracker.ts')
    expect(tracker).toBeDefined()
    expect(tracker!.text).not.toContain('batchCommandPrompt')
  })
})
