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

  // #425/#424: build_command is optional — present only when configured, and
  // placed AFTER write-signal so it can never clobber $TEST_EXIT before the
  // test signal is written.
  it('omits the build-verify step when buildCommand is not given', () => {
    const steps = validateVerifySteps('pytest -q', '.')
    expect(steps.map((s) => s.name)).not.toContain('build-verify')
  })

  it('appends a build-verify step after write-signal when buildCommand is given', () => {
    const steps = validateVerifySteps('pytest -q', '.', 'pnpm typecheck')
    expect(steps.map((s) => s.name)).toEqual(['test-verify', 'write-signal', 'build-verify'])
    const step = steps.find((s) => s.name === 'build-verify')!
    expect(step.tolerant).toBe(true)
    expect(step.command).toContain('pnpm typecheck')
    expect(step.command).toContain('TEST_EXIT=$?')
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

  it('the signal reflects test_command only — a failing build_command never clobbers it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'datum-signal-build-'))
    try {
      execFileSync('bash', ['-c', batchScript(validateVerifySteps('true', dir, 'false'))], { cwd: dir, encoding: 'utf8' })
      const p = join(dir, '.datum', 'last-test-signal.json')
      const sig = JSON.parse(readFileSync(p, 'utf8'))
      expect(sig.status).toBe('pass')
      expect(sig.exit_code).toBe(0)
      expect(sig.command).toBe('true')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// #519: Validate applied lint fixes to the checkout and never committed them,
// so Review diffed a branch that did not contain what Validate had changed.
// A phase that mutates the tree leaves a commit or nothing: the reported
// lint_fixes are committed, and any tracked file still dirty afterwards is
// a named halt, never a silent pass.
import { trackedDirtySteps, trackedDirtyFiles } from './validate-steps'

describe('trackedDirtySteps / trackedDirtyFiles (#519)', () => {
  it('asks git for tracked changes only — untracked operator files never count', () => {
    const steps = trackedDirtySteps('.')
    expect(steps.map((s) => s.name)).toEqual(['tracked-dirty'])
    expect(steps[0].command).toContain('status --porcelain')
    expect(steps[0].command).toContain('--untracked-files=no')
    expect(steps[0].tolerant).toBe(true)
  })

  it('lists the dirty tracked paths and ignores untracked lines', () => {
    const r = trackedDirtyFiles({
      steps: [{ name: 'tracked-dirty', exit_code: 0, stdout: ' M datum/a.py\nM  skills/src/b.ts\n?? graphify-out/\n', stderr: '' }],
      failed: null,
      missing: false,
    })
    expect(r.known).toBe(true)
    expect(r.files).toEqual(['datum/a.py', 'skills/src/b.ts'])
  })

  it('a clean tree is known and empty', () => {
    const r = trackedDirtyFiles({ steps: [{ name: 'tracked-dirty', exit_code: 0, stdout: '', stderr: '' }], failed: null, missing: false })
    expect(r).toEqual({ known: true, files: [], detail: '' })
  })

  it('a missing batch or a failed git status is unknown, never clean', () => {
    const missing = trackedDirtyFiles({ steps: [], failed: null, missing: true })
    expect(missing.known).toBe(false)
    const failed = trackedDirtyFiles({ steps: [{ name: 'tracked-dirty', exit_code: 128, stdout: '', stderr: 'fatal: not a git repository' }], failed: null, missing: false })
    expect(failed.known).toBe(false)
    expect(failed.detail).toContain('not a git repository')
  })
})
