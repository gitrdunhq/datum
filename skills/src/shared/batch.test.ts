// #368 — consecutive command-runner agent() calls collapse into ONE
// datum-cli call whose script lists the commands in order and returns one
// JSON array with per-step exit codes and stdout, failing fast on the first
// non-zero exit unless the step is tolerant.

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import {
  batchScript,
  batchCommandPrompt,
  parseBatchResult,
  stepStdout,
  stepResult,
  describeFailure,
  validateBatchSteps,
  type BatchStep,
} from './batch'

function runScript(script: string): string {
  return execFileSync('bash', ['-c', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

describe('batchScript — step validation', () => {
  it('rejects empty batches, bad names, duplicates and empty commands', () => {
    expect(() => validateBatchSteps([])).toThrow(/no steps/)
    expect(() => validateBatchSteps([{ name: 'Bad Name', command: 'true' }])).toThrow(/invalid step name/)
    expect(() => validateBatchSteps([{ name: 'a', command: 'true' }, { name: 'a', command: 'true' }])).toThrow(/duplicate/)
    expect(() => validateBatchSteps([{ name: 'a', command: '  ' }])).toThrow(/empty command/)
  })

  it('lists every command in order and only fail-fasts after non-tolerant steps', () => {
    const script = batchScript([
      { name: 'one', command: 'echo 1' },
      { name: 'two', command: 'grep -c nothing /dev/null', tolerant: true },
      { name: 'three', command: 'echo 3' },
    ])
    const i1 = script.indexOf('echo 1')
    const i2 = script.indexOf('grep -c nothing')
    const i3 = script.indexOf('echo 3')
    expect(i1).toBeGreaterThan(-1)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
    // exactly two fail-fast guards: after "one" and after "three", none after the tolerant "two"
    const guards = script.split('\n').filter((l) => l.includes('-ne 0 ]; then __end; exit 0; fi'))
    expect(guards).toHaveLength(2)
    const twoBlock = script.slice(i2, i3)
    expect(twoBlock).not.toContain('exit 0')
  })
})

describe('batchScript — executed under real bash', () => {
  it('returns one JSON array with per-step exit codes, stdout and stderr', () => {
    const steps: BatchStep[] = [
      { name: 'hello', command: 'printf "hi\\n"' },
      { name: 'nomatch', command: 'printf "x\\n" | grep -c zzz', tolerant: true },
      { name: 'warn', command: 'echo out; echo err >&2' },
    ]
    const out = runScript(batchScript(steps))
    const r = parseBatchResult(out, steps)
    expect(r.missing).toBe(false)
    expect(r.failed).toBeNull()
    expect(r.steps.map((s) => s.name)).toEqual(['hello', 'nomatch', 'warn'])
    expect(stepStdout(r, 'hello')).toBe('hi\n')
    expect(stepResult(r, 'nomatch')?.exit_code).toBe(1)
    expect(stepStdout(r, 'nomatch')).toBe('0\n')
    expect(stepStdout(r, 'warn')).toBe('out\n')
    expect(stepResult(r, 'warn')?.stderr).toBe('err\n')
  })

  it('stops at the first non-tolerant failure and never runs the later steps', () => {
    const steps: BatchStep[] = [
      { name: 'ok', command: 'echo first' },
      { name: 'boom', command: 'echo "bad thing" >&2; exit 3' },
      { name: 'never', command: 'echo should-not-run' },
    ]
    // `exit` inside a step group exits the whole script — use a subshell-free failure instead
    steps[1].command = 'echo "bad thing" >&2; false'
    const r = parseBatchResult(runScript(batchScript(steps)), steps)
    expect(r.steps.map((s) => s.name)).toEqual(['ok', 'boom'])
    expect(r.failed?.name).toBe('boom')
    expect(r.failed?.exit_code).toBe(1)
    expect(stepStdout(r, 'never')).toBeNull()
    expect(describeFailure(r, 'lane-intake:T1')).toContain('step "boom" exited 1')
    expect(describeFailure(r, 'lane-intake:T1')).toContain('bad thing')
  })

  it('lets a later step see a variable assigned by an earlier one', () => {
    const steps: BatchStep[] = [
      { name: 'set', command: '__root=$(printf "/some/where"); printf "%s" "$__root"' },
      { name: 'use', command: 'printf "%s/child" "$__root"' },
    ]
    const r = parseBatchResult(runScript(batchScript(steps)), steps)
    expect(stepStdout(r, 'use')).toBe('/some/where/child')
  })

  it('preserves heredoc-written patterns verbatim (the #288/#289 quoting path)', () => {
    const steps: BatchStep[] = [
      {
        name: 'pattern',
        command: 'PATFILE=$(mktemp)\ncat > "$PATFILE" <<\'PATTERN_EOF\'\n[+][[:space:]]*(it\\(|test\\(|describe\\()\nPATTERN_EOF\ncat "$PATFILE"',
      },
      { name: 'count', command: 'printf "+ it(\\n+  test(\\nfoo\\n" | grep -c -E -f "$PATFILE"', tolerant: true },
    ]
    const r = parseBatchResult(runScript(batchScript(steps)), steps)
    expect(stepStdout(r, 'pattern')).toBe('[+][[:space:]]*(it\\(|test\\(|describe\\()\n')
    expect(stepStdout(r, 'count')).toBe('2\n')
  })
})

describe('batchCommandPrompt', () => {
  it('tells the agent to run the script once and return stdout verbatim', () => {
    const p = batchCommandPrompt([{ name: 'a', command: 'echo a' }])
    expect(p).toMatch(/ONE invocation/)
    expect(p).toMatch(/return only its stdout/)
    expect(p).toMatch(/do not ask/i)
    expect(p).toMatch(/not a problem to solve/)
    expect(p).toContain('echo a')
  })
})

describe('parseBatchResult', () => {
  const steps: BatchStep[] = [{ name: 'a', command: 'true' }, { name: 'b', command: 'true', tolerant: true }]

  it('accepts a fenced string, a bare string, or an already-parsed array', () => {
    const arr = [{ name: 'a', exit_code: 0, stdout: 'x', stderr: '' }]
    expect(parseBatchResult('```json\n' + JSON.stringify(arr) + '\n```', steps).steps).toHaveLength(1)
    expect(parseBatchResult(JSON.stringify(arr), steps).steps).toHaveLength(1)
    expect(parseBatchResult(arr, steps).steps).toHaveLength(1)
  })

  it('reports missing when the agent returned nothing usable', () => {
    for (const raw of [null, undefined, '', 'MISSING', '{"not":"an array"}']) {
      const r = parseBatchResult(raw, steps)
      expect(r.missing).toBe(true)
      expect(r.steps).toEqual([])
      expect(describeFailure(r, 'x')).toContain('no parseable result')
    }
  })

  it('flags only non-tolerant non-zero exits as failed', () => {
    const r = parseBatchResult([
      { name: 'b', exit_code: 1, stdout: '', stderr: '' },
      { name: 'a', exit_code: 2, stdout: '', stderr: 'nope' },
    ], steps)
    expect(r.failed?.name).toBe('a')
    const ok = parseBatchResult([{ name: 'b', exit_code: 1, stdout: '', stderr: '' }], steps)
    expect(ok.failed).toBeNull()
  })

  it('drops malformed entries and coerces string exit codes', () => {
    const r = parseBatchResult([null, 'junk', { name: 'a', exit_code: '0', stdout: 'ok' }], steps)
    expect(r.steps).toEqual([{ name: 'a', exit_code: 0, stdout: 'ok', stderr: '' }])
  })
})
