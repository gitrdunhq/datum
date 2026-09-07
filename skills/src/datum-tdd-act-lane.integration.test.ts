// task-002 (integration-lanes-2): `kind: 'integration'` lanes take a
// RED-only fast path. RED still runs (the code under test is already merged
// — RED's job is to prove the *new* tests exist and, per Assumption 9,
// carries an `expect_tests_pass` framing so the RED agent expects them to
// PASS, not fail). No GREEN, no skeptic panel, no REFACTOR. The lane's
// outcome is decided entirely by an INDEPENDENT `test-verify` step inside
// the same post-RED datum-cli batch runBatch already makes — never a second
// runBatch call (the NFR is one command-runner invocation per lane).
//
// This harness is copied from datum-tdd-act-lane.calls.test.ts (that file's
// territory is untouched) — same fake-agent / call-log convention, trimmed
// to what an integration lane needs.
//
// NOTE for GREEN: AC1 (a `tsc` shellout below) will also red-line
// `scripts/build-workflows.sh`'s own `tsc -p skills/tsconfig.json` step
// until `Lane` in skills/src/shared/types.ts gains `kind: 'integration'`,
// `expect_tests_pass?: boolean` and `invariants?: string[]` — that's the
// intended order (types.ts is in this lane's files; fix it before
// regenerating the bundle the other tests here read).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { laneSpecHash } from './shared/utils'
import type { Lane } from './shared/types'

// AC1 fixture: assigned to the real `Lane` type (no `as`/cast) so tsc's
// excess-property check on an object literal catches a `kind` member that
// isn't in the union, or a field the interface doesn't declare at all.
const AC1_LANE_FIXTURE: Lane = {
  title: 'integration lane one',
  files: ['src/int.test.ts', 'src/int.ts'],
  kind: 'integration',
  expect_tests_pass: true,
  invariants: ['INV-01', 'INV-03'],
}
void AC1_LANE_FIXTURE

const bundlePath = join(__dirname, '..', 'datum-tdd-act-lane.js')

interface Call { label: string; agentType?: string; prompt: string }
type Responder = (label: string, prompt: string) => unknown

/** JSON array a batched datum-cli script would print. */
function batch(steps: Record<string, string | { stdout?: string; exit_code?: number }>): string {
  return JSON.stringify(Object.entries(steps).map(([name, v]) => (
    typeof v === 'string'
      ? { name, exit_code: 0, stdout: v, stderr: '' }
      : { name, exit_code: v.exit_code ?? 0, stdout: v.stdout ?? '', stderr: '' }
  )))
}

const SPEC_PATH = '/wt/T1/.datum/lane-spec.json'
const SPEC_SHA = 'c0ffee'.repeat(6) + 'abcd'
const witness = { read_witness: { [SPEC_PATH]: SPEC_SHA.slice(0, 12) } }

/** The full lane as lane-plan.json holds it — an integration lane with two
 *  covered upstream tasks and two invariant ids (digest fields, never
 *  acceptance-criteria text — AC17/AC19 forbid runLane reading the latter). */
function integrationLane() {
  return {
    title: 'integration lane one',
    files: ['src/int.test.ts', 'src/int.ts'],
    acceptance_criteria: ['does a', 'does b'],
    depends_on: ['task-002', 'task-003'],
    kind: 'integration' as const,
    expect_tests_pass: true,
    invariants: ['INV-01', 'INV-03'],
  }
}

function integrationResponder(o: { testVerify: 'pass' | 'fail' | 'absent' }): Responder {
  const specSummary = {
    task_id: 'T1', path: SPEC_PATH, bytes: 321, sha: SPEC_SHA,
    spec_hash: laneSpecHash(integrationLane()), ac_count: 2,
  }
  return (label, prompt) => {
    if (label.startsWith('lane-intake:')) {
      return batch({ 'lane-spec': JSON.stringify(specSummary) + '\n', 'lane-spec-bytes': '321\n', 'lane-spec-sha': `${SPEC_SHA}\n`, history: '', cleanup: '', 'skeleton-gen': '{}' })
    }
    if (label.startsWith('red:')) {
      return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'aaa111', files_written: ['src/int.test.ts'], test_exit_code: 0 }
    }
    if (label.startsWith('post-red:')) {
      const steps: Record<string, string> = {
        'count-gate': '{"new_test_count":2,"required":2,"passed":true}',
        'assert-check': '',
        ownership: 'src/int.test.ts\n',
        'scope-read-0': 'it("a", () => { expect(1).toBe(1) })\nit("b", () => { expect(2).toBe(2) })\n',
        'test-count-pattern': 'it\\(|test\\(|describe\\(\n',
        'test-count-after': '2\n',
        'test-count-before': '0\n',
      }
      if (o.testVerify === 'pass') steps['test-verify'] = 'TEST_EXIT=0\n'
      if (o.testVerify === 'fail') steps['test-verify'] = 'TEST_EXIT=1\n'
      // 'absent': no test-verify step at all in the batch.
      return batch(steps)
    }
    return null
  }
}

async function runLane(opts: {
  respond: Responder
  lane?: ReturnType<typeof integrationLane>
  priorCompleted?: string[]
  logs?: string[]
}): Promise<{ calls: Call[]; result: { results: Record<string, { status: string; stage?: string; error?: string; follow_ups?: number; red_only?: boolean }> } }> {
  const bundle = readFileSync(bundlePath, 'utf8')
  const body = bundle.replace(/^export const meta = /m, 'const meta = ')
  const AsyncFunction = Object.getPrototypeOf(async function () { /* */ }).constructor as new (...a: string[]) => (...b: unknown[]) => Promise<unknown>
  const script = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', 'workflow', 'budget', body)

  const calls: Call[] = []
  const agent = async (prompt: string, o?: { label?: string; agentType?: string }) => {
    const label = o?.label || ''
    calls.push({ label, agentType: o?.agentType, prompt })
    return opts.respond(label, prompt)
  }
  const parallel = async <T,>(thunks: Array<() => Promise<T>>) => {
    const out: T[] = []
    for (const t of thunks) out.push(await t())
    return out
  }
  const lane = opts.lane ?? integrationLane()
  const args = {
    batchLaneIds: ['T1'],
    lanePlan: {
      schema_version: 1,
      lane_plan_sha: 'plan-sha',
      lanes: { T1: { ...lane, reads: [], spec_hash: laneSpecHash(lane) } },
      topological_order: ['T1'],
      total_lanes: 1,
    },
    worktreePaths: { T1: '/wt/T1' },
    cfg: { lanePlanPath: 'docs/epics/e/lane-plan.json', epicBranch: 'e', runId: 'r1', testCommand: 'npx vitest run', language: 'typescript', agentTypes: { agentTypes: true, hooksInstalled: true } },
    priorFailures: [],
    priorCompleted: opts.priorCompleted ?? ['task-002', 'task-003'],
    batchTag: '',
  }
  const result = await script(agent, parallel, () => undefined, (m: string) => { if (opts.logs) opts.logs.push(m) }, args, async () => ({}), { total: null, spent: () => 0, remaining: () => 0 })
  return { calls, result: result as { results: Record<string, { status: string; stage?: string; error?: string; follow_ups?: number; red_only?: boolean }> } }
}

const cliCalls = (calls: Call[]) => calls.filter((c) => c.agentType === 'datum-cli')
const runnerLabels = (calls: Call[]) => calls.filter((c) => c.agentType === 'datum-cli').map((c) => c.label.split(':')[0])

describe('task-002 — integration lanes are RED-only and decided on the independent verify', () => {
  it('AC1: Lane accepts kind: "integration" and expect_tests_pass without a cast (tsc -p skills/tsconfig.json, which includes this file, must exit 0)', () => {
    let stderr = ''
    let exitCode = 0
    try {
      execFileSync('npx', ['tsc', '-p', 'skills/tsconfig.json'], { cwd: join(__dirname, '..', '..'), stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer }
      exitCode = err.status ?? 1
      stderr = String(err.stdout || '') + String(err.stderr || '')
    }
    expect(exitCode, stderr).toBe(0)
  })

  it('AC2: RED is dispatched exactly once for an integration lane (one red:T1-labelled call)', async () => {
    const { calls, result } = await runLane({ respond: integrationResponder({ testVerify: 'pass' }) })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const redCalls = calls.filter((c) => c.label.startsWith('red:'))
    expect(redCalls).toHaveLength(1)
    expect(redCalls[0].label).toBe('red:T1')
  })

  it('AC3: zero GREEN/skeptic/refactor calls are dispatched for an integration lane, only lane-intake and post-red runner labels appear', async () => {
    const { calls } = await runLane({ respond: integrationResponder({ testVerify: 'pass' }) })
    expect(calls.some((c) => c.label.startsWith('green:'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('skeptic-'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('refactor'))).toBe(false)
    // Pins the exact runner-call sequence so an early intake death (which
    // would also vacuously satisfy "zero GREEN calls") fails loudly instead.
    expect(runnerLabels(calls)).toEqual(['lane-intake', 'post-red'])
  })

  it('AC4: exactly one datum-cli batch contains a test-verify step, and no second runBatch call is made beyond post-red', async () => {
    const { calls } = await runLane({ respond: integrationResponder({ testVerify: 'pass' }) })
    const verifyBatches = cliCalls(calls).filter((c) => /test-verify/.test(c.prompt) || c.label.startsWith('post-red:'))
    expect(cliCalls(calls)).toHaveLength(2) // lane-intake + post-red
    const postRed = cliCalls(calls).find((c) => c.label.startsWith('post-red:'))!
    expect(postRed).toBeDefined()
    expect(verifyBatches.map((c) => c.label.split(':')[0])).toEqual(['lane-intake', 'post-red'].filter((l) => l === 'post-red'))
  })

  it('AC5: the RED prompt for an expect_tests_pass lane names its invariants verbatim and states the tests must PASS', async () => {
    const { calls } = await runLane({ respond: integrationResponder({ testVerify: 'pass' }) })
    const red = calls.find((c) => c.label.startsWith('red:'))!
    expect(red.prompt).toContain('This lane covers invariants: INV-01, INV-03')
    expect(red.prompt).toContain('The code under test is already merged: these tests must PASS on your first run; a failing test is a finding, report it, do not weaken it.')
  })

  it('AC6: test-verify exit 0 completes the lane at RED with follow_ups unchanged (undefined — no skeptic panel ran)', async () => {
    const { result } = await runLane({ respond: integrationResponder({ testVerify: 'pass' }) })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(result.results.T1.stage).toBe('RED')
    expect(result.results.T1.red_only, '#498: the merge filter needs this to let a RED completion merge').toBe(true)
    expect(result.results.T1.follow_ups).toBeUndefined()
  })

  it('AC7: test-verify exit 1 fails the lane with the byte-exact integration_failed string built from depends_on and invariants', async () => {
    const { result } = await runLane({ respond: integrationResponder({ testVerify: 'fail' }) })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toBe('integration_failed: covered task-002, task-003; invariants INV-01, INV-03 (independent verify exit=1)')
  })

  it('AC8: a missing test-verify step (no TEST_EXIT= line) fails the lane via verifyVerdict\'s "unavailable" path, never a silent pass', async () => {
    const { result } = await runLane({ respond: integrationResponder({ testVerify: 'absent' }) })
    expect(result.results.T1.status).not.toBe('completed')
    expect(result.results.T1.error).toMatch(/^green_verify_unavailable:/)
  })

  it('AC9: kind: "integration" with expect_tests_pass missing/false still takes the RED-only fast path and logs a disagreement warning', async () => {
    const laneNoExpect = { ...integrationLane(), expect_tests_pass: undefined as unknown as boolean }
    const logs: string[] = []
    const { calls, result } = await runLane({ respond: integrationResponder({ testVerify: 'pass' }), lane: laneNoExpect, logs })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(result.results.T1.stage).toBe('RED')
    expect(calls.some((c) => c.label.startsWith('green:'))).toBe(false)
    expect(logs.some((l) => /expect_tests_pass/i.test(l) && /kind/i.test(l))).toBe(true)
    // Review ARCH-003: the RED agent is told its tests must pass whenever the
    // fast path will judge them that way, drift or not.
    const red = calls.find((c) => c.label.startsWith('red:'))!
    expect(red.prompt).toContain('these tests must PASS on your first run')
  })

  // Regression pin, not a new behaviour: existing structural/behavioral lanes
  // are unaffected by this lane. This is expected to already pass — the pin
  // guards against a future change to isStructural / the kind === 'behavioral'
  // fallthrough accidentally swallowing 'integration' handling into them.
  // #341 task-001: the structural path is one writing stage (datum-structural)
  // decided by the deliverable check, never the optional REFACTOR cleanup
  // whose pre-check said "nothing to improve" on a doc that did not exist.
  const structuralLane = { title: 'structural one', files: ['docs/a.md'], acceptance_criteria: ['does a'], kind: 'structural' as const }
  function structuralResponder(o: { delivered: boolean }): Responder {
    return (label) => {
      if (label.startsWith('lane-intake:')) {
        const specSummary = { task_id: 'T1', path: SPEC_PATH, bytes: 321, sha: SPEC_SHA, spec_hash: laneSpecHash(structuralLane), ac_count: 1 }
        return batch({ 'lane-spec': JSON.stringify(specSummary) + '\n', 'lane-spec-bytes': '321\n', 'lane-spec-sha': `${SPEC_SHA}\n`, history: '', cleanup: '', 'skeleton-gen': '{}' })
      }
      if (label.startsWith('structural-check:')) return batch({ 'deliverable-check': 'MISSING docs/a.md\n', 'deliverable-commits': '' })
      if (label.startsWith('structural:')) return { success: true, tests_pass: true, test_exit_code: 0, committed: true, commit_sha: 'abc1234', files_written: ['docs/a.md'] }
      if (label.startsWith('structural-verify:')) {
        return o.delivered
          ? batch({ 'deliverable-check': '', 'deliverable-commits': 'abc1234 refactor(T1): REFACTOR complete\n' })
          : batch({ 'deliverable-check': 'MISSING docs/a.md\n', 'deliverable-commits': '' })
      }
      return null
    }
  }

  it('AC10 (regression pin): a kind: "structural" lane runs the STRUCTURAL writing stage only, untouched by the integration path', async () => {
    const { result, calls } = await runLane({ respond: structuralResponder({ delivered: true }), lane: structuralLane as unknown as ReturnType<typeof integrationLane>, priorCompleted: [] })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(result.results.T1.stage).toBe('REFACTOR')
    expect(calls.some((c) => c.label.startsWith('red:'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('refactor-check:'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('structural:'))).toBe(true)
  })

  it('a STRUCTURAL agent that reports success while the declared file stays missing fails the lane by name', async () => {
    const { result } = await runLane({ respond: structuralResponder({ delivered: false }), lane: structuralLane as unknown as ReturnType<typeof integrationLane>, priorCompleted: [] })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/^structural_deliverable_missing: docs\/a\.md/)
  })
})

// run 20260907-015322: INT-5's verify ran the whole suite and an unrelated
// red became `integration_failed`. The post-red verify for an integration
// lane names the lane's own test files.
describe('integration lane — the independent verify runs the lane\'s own test files', () => {
  it('the post-red batch\'s test-verify command carries the lane test file, not the bare suite command', async () => {
    const { calls } = await runLane({ respond: integrationResponder({ testVerify: 'pass' }) })
    const postRed = cliCalls(calls).find((c) => c.label.startsWith('post-red:'))!
    expect(postRed.prompt).toContain('npx vitest run src/int.test.ts')
  })
})
