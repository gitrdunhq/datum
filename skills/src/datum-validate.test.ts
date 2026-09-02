// #358 — datum-validate never checked whether the epic branch is behind
// main, and lane/validate prompts ran the test suite through a pipe that
// masked the exit code.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseValidateArgs, mainSyncPrompt, evaluateMainSync, testRunCommand } from './shared/utils'

const validateSrc = readFileSync(join(__dirname, 'datum-validate.ts'), 'utf8')
const promptsDir = join(__dirname, 'prompts')

describe('#358 — parseValidateArgs', () => {
  it('accepts the bare yolo string', () => {
    expect(parseValidateArgs('yolo')).toEqual({ yolo: true, noMergeMain: false })
  })
  it('accepts a --no-merge-main flag, alone or with yolo', () => {
    expect(parseValidateArgs('--no-merge-main')).toEqual({ yolo: false, noMergeMain: true })
    expect(parseValidateArgs('yolo --no-merge-main')).toEqual({ yolo: true, noMergeMain: true })
  })
  it('accepts JSON args', () => {
    expect(parseValidateArgs('{"yolo": true, "noMergeMain": true, "testCommand": "make test"}')).toMatchObject({ yolo: true, noMergeMain: true, testCommand: 'make test' })
    expect(parseValidateArgs({ noMergeMain: true })).toMatchObject({ yolo: false, noMergeMain: true })
  })
  it('defaults to merging main', () => {
    expect(parseValidateArgs('')).toEqual({ yolo: false, noMergeMain: false })
    expect(parseValidateArgs(undefined)).toEqual({ yolo: false, noMergeMain: false })
  })
})

describe('#358 — mainSyncPrompt / evaluateMainSync', () => {
  it('always fetches origin main and counts how far behind HEAD is', () => {
    for (const noMerge of [true, false]) {
      const p = mainSyncPrompt(noMerge)
      expect(p).toContain('git fetch origin main')
      expect(p).toContain('git rev-list --count HEAD..origin/main')
    }
  })
  it('merges origin/main by default and only reports when --no-merge-main is set', () => {
    expect(mainSyncPrompt(false)).toContain('git merge --no-edit origin/main')
    expect(mainSyncPrompt(true)).not.toContain('git merge')
  })
  it('fails loudly with the behind count when merging is disabled and the epic is behind', () => {
    const r = evaluateMainSync({ behind: 7, merged: false, conflict: false }, true)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/epic is 7 commits behind main/)
  })
  it('passes when not behind, with or without merging', () => {
    expect(evaluateMainSync({ behind: 0, merged: false, conflict: false }, true).ok).toBe(true)
    expect(evaluateMainSync({ behind: 0, merged: false, conflict: false }, false).ok).toBe(true)
  })
  it('passes after a clean merge and fails on a conflict', () => {
    expect(evaluateMainSync({ behind: 3, merged: true, conflict: false }, false).ok).toBe(true)
    const c = evaluateMainSync({ behind: 3, merged: false, conflict: true, output: 'CONFLICT (content): x.py' }, false)
    expect(c.ok).toBe(false)
    expect(c.message).toMatch(/conflict/i)
  })
  it('fails when the sync result is missing (fetch failed / unparseable)', () => {
    expect(evaluateMainSync(null, false).ok).toBe(false)
  })
})

describe('#358 — testRunCommand writes output to a file and reads the exit status directly', () => {
  const cmd = testRunCommand('uv run pytest -x -q', '/tmp/wt', 'GREEN')
  it('redirects the suite output to a log file instead of piping it', () => {
    expect(cmd).toMatch(/uv run pytest -x -q[^|]*> "?[^ ]*test-output-GREEN\.log"? 2>&1/)
    expect(cmd).not.toMatch(/pytest[^;]*\|/)
  })
  it('captures the exit status right after the command, before any tail', () => {
    const exitIdx = cmd.indexOf('TEST_EXIT=$?')
    const tailIdx = cmd.indexOf('tail -')
    expect(exitIdx).toBeGreaterThan(-1)
    expect(tailIdx).toBeGreaterThan(exitIdx)
    expect(cmd).toContain('echo "TEST_EXIT=$TEST_EXIT"')
  })
})

describe('#358 — validate + lane prompts use the file-backed test run', () => {
  it('every prompt that runs the suite uses {{testRunCmd}} and never pipes into tail', () => {
    for (const name of ['red.md', 'red-retry.md', 'green.md', 'green-retry.md', 'refactor.md', 'validate-check.md']) {
      const text = readFileSync(join(promptsDir, name), 'utf8')
      expect(text, name).toMatch(/\{\{testRunCmd\}\}/)
      expect(text, name).not.toMatch(/\| *tail/)
      expect(text, name).not.toMatch(/Run \{\{testCommand\}\}/)
    }
  })
  it('datum-validate.ts syncs with main before running the validate check', () => {
    const syncIdx = validateSrc.indexOf('mainSyncPrompt(')
    const checkIdx = validateSrc.indexOf("label: 'validate-check'")
    expect(syncIdx).toBeGreaterThan(-1)
    expect(syncIdx).toBeLessThan(checkIdx)
    expect(validateSrc).toMatch(/evaluateMainSync\(/)
    expect(validateSrc).toMatch(/parseValidateArgs\(/)
  })
})
