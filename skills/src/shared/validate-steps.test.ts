// Validate's independent test run must also PRODUCE the test signal that
// `datum gate validate` consumes (.datum/last-test-signal.json) — the gate had
// a consumer with no producer and passed silently when the file was absent.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateVerifySteps } from './validate-steps'
import { batchScript } from './batch'

describe('validateVerifySteps', () => {
  it('runs the suite via testRunCommand then writes the signal from the same shell ($TEST_EXIT)', () => {
    const steps = validateVerifySteps('pytest -q', '.')
    expect(steps.map((s) => s.name)).toEqual(['test-verify', 'write-signal'])
    expect(steps[0].command).toContain('TEST_EXIT=$?')
    expect(steps[0].command).toContain('pytest -q')
    expect(steps[1].command).toContain('.datum/last-test-signal.json')
    expect(steps[1].command).toContain('TEST_EXIT')
    expect(steps.every((s) => s.tolerant)).toBe(true)
  })

  it('really writes a pass signal for a green command and a fail signal for a red one', () => {
    for (const [cmd, status, exit] of [['true', 'pass', 0], ['false', 'fail', 1]] as const) {
      const dir = mkdtempSync(join(tmpdir(), 'datum-signal-'))
      try {
        execFileSync('bash', ['-c', batchScript(validateVerifySteps(cmd, dir))], { cwd: dir, encoding: 'utf8' })
        const p = join(dir, '.datum', 'last-test-signal.json')
        expect(existsSync(p)).toBe(true)
        const sig = JSON.parse(readFileSync(p, 'utf8'))
        expect(sig.status).toBe(status)
        expect(sig.exit_code).toBe(exit)
        expect(sig.command).toBe(cmd)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  })
})
