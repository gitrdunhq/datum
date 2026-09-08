// prompts.test.ts — the shared preamble every stage agent reads first.
// The .md is read from disk: vitest has no loader for the esbuild text import.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const preamble = readFileSync(join(__dirname, '..', 'prompts', 'agent-preamble.md'), 'utf8')

describe('agent preamble — test command source (#373)', () => {
  // A lane worktree only carries .datum/config.json because setup copied it;
  // the brief always carries test_command. Telling agents to read the config
  // file first sent them to a missing file and the guessed default.
  it('tells agents the test command is the test_command in their brief', () => {
    expect(preamble).toMatch(/test_command/)
    expect(preamble).toMatch(/brief/i)
  })

  it('no longer points agents at .datum/config.json as the place to read it from', () => {
    expect(preamble).not.toMatch(/read it, don't guess/)
    expect(preamble).not.toMatch(/\(from `\.datum\/config\.json`\)/)
  })

  it('forbids falling back to a guessed default when the file is missing', () => {
    expect(preamble).toMatch(/never (guess|fall back)/i)
  })
})
