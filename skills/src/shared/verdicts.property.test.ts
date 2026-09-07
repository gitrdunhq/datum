// Property tests over the pure verdict functions. Every one of them is a
// partial function over a small input space with a few NAMED outcomes, and
// every "null read as failed" bug this week (elonchesd wf_dee84cc2-e64: an
// empty verify reply reported as a red suite; the ast-grep fallback firing on
// "no match") was the same shape: tested on the happy inputs, wrong on the
// absent ones. The properties below pin the invariants, not examples:
//   - a verdict is always one of its named outcomes;
//   - "failed" implies evidence (a parsed exit code, a parsed step);
//   - absence is named, never "clean" and never "failed".

import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { parseBatchResult, describeFailure, type BatchStep } from './batch'
import { testExitCode, verifyVerdict, strayFilesFromSteps, strayCleanSteps } from './lane-steps'
import { classifyLaneError, triageDestination } from './triage-classify'
import { verifyReadWitness, type ContextFile } from './context-relay'

const hex = fc.stringMatching(/^[0-9a-f]{40}$/)
const stepName = fc.stringMatching(/^[a-z][a-z0-9-]{0,12}$/)

/** Any reply a runner could hand back: JSON arrays of steps, prose, empties, junk. */
const stepRecord = fc.record({
  name: stepName,
  exit_code: fc.oneof(fc.integer({ min: 0, max: 255 }), fc.constant('7'), fc.constant(undefined)),
  stdout: fc.oneof(fc.string(), fc.constant(undefined)),
  stderr: fc.oneof(fc.string(), fc.constant(undefined)),
})
const runnerReply = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(''),
  fc.string(),
  fc.array(stepRecord).map((a) => JSON.stringify(a)),
  fc.array(stepRecord),
  fc.array(stepRecord).map((a) => '```json\n' + JSON.stringify(a) + '\n```'),
)

describe('parseBatchResult / describeFailure', () => {
  it('never throws, and a missing result always has a named description', () => {
    fc.assert(fc.property(runnerReply, fc.array(fc.record({ name: stepName, command: fc.constant('true'), tolerant: fc.boolean() }), { minLength: 1, maxLength: 4 }), (reply, steps) => {
      const r = parseBatchResult(reply, steps as BatchStep[])
      const text = describeFailure(r, 'label')
      expect(text.startsWith('label: ')).toBe(true)
      if (r.missing) {
        expect(r.steps).toEqual([])
        expect(r.failed).toBeNull()
        // absence is named: one of the runner-failure names, never a bare "failed"
        expect(text).toMatch(/runner_empty_result|runner_no_json|runner_permission_denied|batch_script_corrupt|batch_root_missing/)
      } else {
        // a failed step is always one of the parsed steps with a non-zero exit, never tolerant
        if (r.failed) {
          expect(r.steps).toContain(r.failed)
          expect(r.failed.exit_code).not.toBe(0)
          expect(steps.find((s) => s.name === r.failed!.name)?.tolerant ?? false).toBe(false)
        }
      }
    }), { numRuns: 400 })
  })
})

describe('testExitCode / verifyVerdict', () => {
  const stdoutWithExit = fc.tuple(fc.string(), fc.integer({ min: 0, max: 255 }), fc.string()).map(([a, n, b]) => `${a}\nTEST_EXIT=${n}\n${b}`)
  it('testExitCode is the LAST TEST_EXIT line, or null when there is none', () => {
    fc.assert(fc.property(fc.oneof(fc.constant(null), fc.constant(undefined), fc.string(), stdoutWithExit), (s) => {
      const code = testExitCode(s)
      const matches = [...(s ?? '').matchAll(/TEST_EXIT=(\d+)/g)]
      if (matches.length === 0) expect(code).toBeNull()
      else expect(code).toBe(Number(matches[matches.length - 1][1]))
    }))
  })
  it('a verify verdict is passed, failed WITH an exit code, or unavailable — never failed on an absent code', () => {
    fc.assert(fc.property(runnerReply, (reply) => {
      const steps: BatchStep[] = [{ name: 'test-verify', command: 'npm test', tolerant: true }]
      const r = parseBatchResult(reply, steps)
      const v = verifyVerdict(r, 'post-green-verify')
      expect(['passed', 'failed', 'unavailable']).toContain(v.kind)
      if (v.kind === 'failed') {
        expect(typeof v.exit).toBe('number')
        expect(v.exit).not.toBe(0)
      }
      if (v.kind === 'passed') expect(v.exit).toBe(0)
      if (v.kind === 'unavailable') {
        expect(v.exit).toBeNull()
        expect(v.why.startsWith('post-green-verify: ')).toBe(true)
      }
      // the verdict is a pure function of the parsed exit code
      const exit = testExitCode(r.steps.find((s) => s.name === 'test-verify')?.stdout ?? null)
      expect(v.kind).toBe(exit === null ? 'unavailable' : exit === 0 ? 'passed' : 'failed')
    }), { numRuns: 400 })
  })
})

describe('strayFilesFromSteps', () => {
  it('absence is a named null, never "clean"; strays are the sorted listed paths', () => {
    fc.assert(fc.property(runnerReply, (reply) => {
      const r = parseBatchResult(reply, strayCleanSteps('/wt'))
      const o = strayFilesFromSteps(r)
      const listed = r.steps.find((s) => s.name === 'stray-list')
      const confirm = r.steps.find((s) => s.name === 'stray-confirm')
      if (!listed || !confirm) {
        expect(o).toEqual({ strays: [], cleaned: null })
      } else {
        expect(o.strays).toEqual([...o.strays].sort())
        expect(o.cleaned).toBe(confirm.stdout.trim() === '')
      }
    }), { numRuns: 300 })
  })
})

describe('classifyLaneError / triageDestination', () => {
  it('every error string gets exactly one category with a destination; a named datum prefix is never "consumer"', () => {
    const datumPrefixes = ['runner_permission_denied', 'batch_script_corrupt', 'batch_root_missing', 'green_verify_unavailable', 'lane_intake_failed', 'count_gate_no_output', 'test_env_missing', 'green_no_result', 'red_no_result']
    fc.assert(fc.property(fc.string(), fc.constantFrom(...datumPrefixes), fc.string(), fc.constantFrom('RED', 'GREEN', 'REFACTOR', 'SKIPPED', undefined), (pre, prefix, post, stage) => {
      const c = classifyLaneError(`${pre} ${prefix}: ${post}`, stage)
      expect(['infrastructure', 'workflow_bug', 'lane_plan', 'agent_behavior', 'test_quality', 'dependency', 'unknown']).toContain(c.category)
      expect(['datum', 'consumer', 'none']).toContain(triageDestination(c, ''))
      if (stage !== 'SKIPPED' && !/^blocked[:\s]/.test(`${pre} ${prefix}`)) {
        expect(c.category, `${prefix} inside "${pre} ${prefix}: ${post}"`).toBe('infrastructure')
        expect(triageDestination(c, '')).toBe('datum')
      }
    }), { numRuns: 300 })
  })
  it('an unknown error is heuristic and goes to the consumer, never to datum on no evidence', () => {
    fc.assert(fc.property(fc.string().filter((s) => !/[a-z_]+_[a-z_]+/.test(s) && !/blocked|no worktree path/.test(s)), (s) => {
      const c = classifyLaneError(s, 'GREEN')
      expect(c.confidence).toBe('heuristic')
      expect(triageDestination(c, s)).toBe('consumer')
    }))
  })
})

describe('verifyReadWitness', () => {
  const deferred = (sha: string): ContextFile => ({ path: 'spec.json', exists: true, inlined: false, bytes: 10, sha, content: null })
  it('a value sharing >= 7 leading hex chars with the sha verifies; fewer never does, whatever the shape around it', () => {
    fc.assert(fc.property(hex, fc.integer({ min: 0, max: 40 }), fc.stringMatching(/^[0-9a-f]{0,12}$/), fc.constantFrom('path', 'sha', 'whatever'), (sha, keep, tail, keyKind) => {
      const value = sha.slice(0, keep) + tail
      if (!/^[0-9a-f]+$/.test(value) || value.length === 0) return
      const key = keyKind === 'path' ? 'spec.json' : keyKind === 'sha' ? sha : 'x'
      const r = verifyReadWitness([deferred(sha)], { read_witness: { [key]: value } })
      let common = 0
      while (common < value.length && common < sha.length && value[common] === sha[common]) common++
      // The proof may sit in the KEY (BUG K: keyed by the full sha; BUG K3:
      // the prefix as key) — a full-sha key is proof on its own.
      if (keyKind === 'sha') {
        expect(r.ok, `key=sha value=${value}`).toBe(true)
        return
      }
      if (common >= 7) {
        expect(r.ok, `value=${value} sha=${sha}`).toBe(true)
        expect(r.nearMiss).toEqual(value.length === common ? [] : ['spec.json'])
      } else {
        expect(r.ok, `value=${value} sha=${sha}`).toBe(false)
      }
    }), { numRuns: 500 })
  })
})
