// #358 — datum-validate never checked whether the epic branch is behind
// main, and lane/validate prompts ran the test suite through a pipe that
// masked the exit code.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseValidateArgs, evaluateMainSync, testRunCommand } from './shared/utils'

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

describe('#358 — evaluateMainSync', () => {
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
    const syncIdx = validateSrc.indexOf('mainSyncSteps(')
    const checkIdx = validateSrc.indexOf("label: 'validate-check'")
    expect(syncIdx).toBeGreaterThan(-1)
    expect(syncIdx).toBeLessThan(checkIdx)
    expect(validateSrc).toMatch(/evaluateMainSync\(/)
    expect(validateSrc).toMatch(/parseValidateArgs\(/)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix — main sync (fetch/behind-count/merge) is a deterministic
// datum-cli batch (shared/main-sync-steps.ts), not an LLM relay that fetches,
// merges and self-reports {behind, merged, conflict} JSON.
// ---------------------------------------------------------------------------

describe('determinism fix — main sync is a deterministic batch, not an LLM relay', () => {
  it('no longer imports or calls the retired mainSyncPrompt relay', () => {
    expect(validateSrc).not.toMatch(/mainSyncPrompt/)
  })

  it('imports mainSyncSteps/mainSyncFromSteps from shared/main-sync-steps', () => {
    expect(validateSrc).toMatch(/import\s*\{[^}]*mainSyncSteps[^}]*mainSyncFromSteps[^}]*\}\s*from\s*'\.\/shared\/main-sync-steps'/)
  })

  it('runs the sync steps through batchCommandPrompt/parseBatchResult like every other cli batch', () => {
    const syncIdx = validateSrc.indexOf('mainSyncSteps(')
    const block = validateSrc.slice(syncIdx, syncIdx + 400)
    expect(block).toMatch(/batchCommandPrompt\(/)
    expect(block).toMatch(/parseBatchResult\(/)
    expect(block).toMatch(/stageOpts\(\s*'cli'/)
  })
})

describe('#validate-gate-determinism — the pass/fail bit comes from an independent test run, not the LLM self-report', () => {
  it('runs the test command itself as a deterministic datum-cli batch step', () => {
    // One agent() call built from batchCommandPrompt(...) with stageOpts('cli', ...),
    // mirroring the RED-stage post-red batch (datum-tdd-act-lane.ts) — not the
    // validate-check agent's own self-reported test run.
    expect(validateSrc).toMatch(/batchCommandPrompt\(/)
    expect(validateSrc).toMatch(/stageOpts\(\s*'cli'/)
    expect(validateSrc).toMatch(/parseBatchResult\(/)
  })

  it('derives testsPassed from testExitCode(...) === 0, not from the agent-reported tests_pass', () => {
    expect(validateSrc).toMatch(/testExitCode\(/)
    // The final testsPassed assignment must not be a bare pass-through of the
    // LLM's self-reported field.
    expect(validateSrc).not.toMatch(/testsPassed:\s*!!check\?\.tests_pass/)
  })

  it('imports testExitCode from shared/lane-steps and batch helpers from shared/batch', () => {
    expect(validateSrc).toMatch(/from '\.\/shared\/lane-steps'/)
    expect(validateSrc).toMatch(/from '\.\/shared\/batch'/)
  })

  it('a non-zero deterministic exit fails validation regardless of the agent self-report', () => {
    // Looks for the exit-code-driven branch, distinct from the old
    // `!check?.tests_pass` gate condition.
    expect(validateSrc).not.toMatch(/else if \(!check\?\.tests_pass\)/)
    expect(validateSrc).toMatch(/testExit\s*!==\s*0/)
  })

  it('a null exit code (deterministic step never ran) fails loudly with an explicit reason, never a silent pass', () => {
    expect(validateSrc).toMatch(/testExit\s*===\s*null/)
    expect(validateSrc).toMatch(/validate_run_failed/)
  })

  it('the workflow result carries the deterministic exit code alongside testsPassed', () => {
    expect(validateSrc).toMatch(/testExitCode:\s*testExit/)
  })
})

// ---------------------------------------------------------------------------
// The phase gate verdict must come from the CLI's exit code via a
// deterministic batch step (shared/gate.ts), never from an LLM agent that
// ran `datum gate` and echoed the JSON back.
// ---------------------------------------------------------------------------

describe('datum-validate — deterministic gate verdict', () => {
  const src = readFileSync(join(__dirname, 'datum-validate.ts'), 'utf8')
  it('runs the gate through gateSteps/parseGateResult, not the util-run-gate LLM relay', () => {
    expect(src).not.toMatch(/util-run-gate/)
    expect(src).toMatch(/gateSteps\(/)
    expect(src).toMatch(/parseGateResult\(/)
  })
})

describe('datum-validate produces the test signal the validate gate consumes', () => {
  const src = readFileSync(join(__dirname, 'datum-validate.ts'), 'utf8')
  it('runs the independent test run through validateVerifySteps (test-verify + write-signal)', () => {
    expect(src).toMatch(/validateVerifySteps\(/)
    expect(src).not.toMatch(/name: 'test-verify', command: testRunCommand/)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix (#368 follow-up) — util-read-context.md was an unused
// import in datum-validate.ts (this script already derives branch/epic_dir
// deterministically inline via `git rev-parse --abbrev-ref HEAD` embedded in
// its own prompt text; nothing here ever called agent(readContextTemplate,
// ...)). The dead import is removed, and now that no script under skills/src
// imports the LLM relay template any more, the file itself is deleted.
// ---------------------------------------------------------------------------

describe('determinism fix — util-read-context.md LLM relay is fully retired', () => {
  it('datum-validate.ts no longer imports the unused util-read-context.md template', () => {
    expect(validateSrc).not.toMatch(/from '\.\/prompts\/util-read-context\.md'/)
  })

  it('no file under skills/src imports util-read-context.md any more', () => {
    const srcDir = join(__dirname)
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
          const contents = readFileSync(full, 'utf8')
          if (/from ['"][^'"]*prompts\/util-read-context\.md['"]/.test(contents)) {
            offenders.push(full)
          }
        }
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })

  it('the util-read-context.md prompt file itself no longer exists', () => {
    expect(existsSync(join(__dirname, 'prompts', 'util-read-context.md'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix — the standalone-run config read no longer relays through
// READ_CONFIG_PROMPT (an LLM "read two configs and merge them by hand"),
// it uses the same shared/config-steps.ts batch as datum-plan.ts.
// ---------------------------------------------------------------------------

describe('determinism fix — config read is a deterministic batch, not an LLM relay', () => {
  it('no longer imports or calls agent(READ_CONFIG_PROMPT ...)', () => {
    expect(validateSrc).not.toMatch(/READ_CONFIG_PROMPT/)
  })

  it('imports configReadSteps/configFromSteps from shared/config-steps', () => {
    expect(validateSrc).toMatch(/import\s*\{[^}]*configReadSteps[^}]*configFromSteps[^}]*\}\s*from\s*'\.\/shared\/config-steps'/)
  })
})
