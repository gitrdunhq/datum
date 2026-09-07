// config-steps.ts replaces the LLM READ_CONFIG_PROMPT relay (shared/models.ts)
// with a deterministic batch (cat + parse) shared by datum-plan.ts,
// datum-validate.ts and datum-tdd-act.ts.

import { describe, it, expect } from 'vitest'
import { configReadSteps, configFromSteps, MISSING_CONFIG_MESSAGE } from './config-steps'
import { parseBatchResult, batchScript, type BatchStep } from './batch'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function runBatch(steps: BatchStep[], cwd: string): ReturnType<typeof parseBatchResult> {
  const out = execFileSync('bash', ['-c', batchScript(steps)], { cwd, encoding: 'utf8' })
  return parseBatchResult(out, steps)
}

describe('configReadSteps', () => {
  it('reads repo-config (non-tolerant) and global-config (tolerant)', () => {
    const steps = configReadSteps()
    expect(steps.map((s) => s.name)).toEqual(['repo-config', 'global-config'])
    expect(steps[0].command).toContain('cat .datum/config.json')
    expect(steps[0].tolerant).toBeFalsy()
    expect(steps[1].tolerant).toBe(true)
  })
})

describe('configFromSteps', () => {
  let dir: string

  it('merges global defaults with repo overrides, repo winning', () => {
    dir = mkdtempSync(join(tmpdir(), 'datum-config-'))
    try {
      mkdirSync(join(dir, '.datum'), { recursive: true })
      writeFileSync(join(dir, '.datum', 'config.json'), JSON.stringify({ test_command: 'repo cmd', language: 'ts' }))
      const result = runBatch(configReadSteps(), dir)
      const merged = configFromSteps(result)
      expect(merged.test_command).toBe('repo cmd')
      expect(merged.language).toBe('ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws MISSING_CONFIG_MESSAGE when .datum/config.json does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'datum-config-'))
    try {
      const result = runBatch(configReadSteps(), dir)
      expect(() => configFromSteps(result)).toThrow(MISSING_CONFIG_MESSAGE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws MISSING_CONFIG_MESSAGE when repo config is present but not valid JSON', () => {
    dir = mkdtempSync(join(tmpdir(), 'datum-config-'))
    try {
      mkdirSync(join(dir, '.datum'), { recursive: true })
      writeFileSync(join(dir, '.datum', 'config.json'), 'not json{')
      const result = runBatch(configReadSteps(), dir)
      expect(() => configFromSteps(result)).toThrow(MISSING_CONFIG_MESSAGE)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('throws MISSING_CONFIG_MESSAGE when the batch agent returned nothing parseable', () => {
    const missingResult = parseBatchResult(null, configReadSteps())
    expect(() => configFromSteps(missingResult)).toThrow(MISSING_CONFIG_MESSAGE)
  })

  it('a failed repo-config step is caught by name even when its stdout happens to carry valid JSON — never silently falls through to that JSON', () => {
    // Hand-built BatchResult: repo-config's step is the one result.failed
    // points at, but its stdout is (implausibly) still valid JSON. Real
    // batchScript() output can't produce this shape (a non-tolerant failure
    // stops the script before any later processing), but a caller must not
    // rely on that invariant — distinguishes the explicit
    // result.missing/result.failed guard from the JSON.parse-throws fallback
    // below it.
    const hand = {
      steps: [{ name: 'repo-config', exit_code: 1, stdout: '{"test_command":"should never be used"}', stderr: 'cat: permission denied' }],
      failed: { name: 'repo-config', exit_code: 1, stdout: '{"test_command":"should never be used"}', stderr: 'cat: permission denied' },
      missing: false,
    }
    expect(() => configFromSteps(hand)).toThrow(MISSING_CONFIG_MESSAGE)
  })

  it('degrades a broken global config to {} instead of failing', () => {
    dir = mkdtempSync(join(tmpdir(), 'datum-config-'))
    try {
      mkdirSync(join(dir, '.datum'), { recursive: true })
      writeFileSync(join(dir, '.datum', 'config.json'), JSON.stringify({ test_command: 'repo cmd' }))
      // Simulate a broken global config by writing steps manually.
      const steps = configReadSteps()
      steps[1] = { ...steps[1], command: "printf 'not json'" }
      const result = runBatch(steps, dir)
      const merged = configFromSteps(result)
      expect(merged.test_command).toBe('repo cmd')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
