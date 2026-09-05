// #368 — run the COMPILED lane bundle against a fake agent() and count the
// calls. The lane runner is a sandbox script (host-injected `agent`, `args`,
// `parallel`, ...), so the bundle is evaluated inside an async function with
// those globals supplied as parameters. Every agent() call is recorded with
// its label and agentType; the assertions count command-runner
// (datum-cli / datum-reader) calls per lane and check the stage agents carry
// their datum-* definitions.
//
// Requires skills/datum-tdd-act-lane.js to be rebuilt from source
// (bash scripts/build-workflows.sh) — the bundle is committed.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { laneSpecHash } from './shared/utils'

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
/** What every agent that read the lane-spec file must carry (assertReadWitness). */
const witness = { read_witness: { [SPEC_PATH]: SPEC_SHA.slice(0, 12) } }

/** The full lane as lane-plan.json holds it (acceptance criteria included). */
function fullLane(o: { pytest: boolean }) {
  const files = o.pytest ? ['tests/test_a.py', 'src/a.py'] : ['src/a.test.ts', 'src/a.ts']
  return { title: 'lane one', files, acceptance_criteria: ['does a', 'does b'] }
}

function happyPathResponder(o: { pytest: boolean }): Responder {
  const testFile = o.pytest ? 'tests/test_a.py' : 'src/a.test.ts'
  const implFile = o.pytest ? 'src/a.py' : 'src/a.ts'
  // The lane exports its full spec to a worktree file at intake; the runner
  // returns only the short summary. Stage agents evidence the read with the
  // file's blob sha prefix (read_witness), which the script verifies.
  const specSummary = { task_id: 'T1', path: SPEC_PATH, bytes: 321, sha: SPEC_SHA, spec_hash: laneSpecHash(fullLane(o)), ac_count: 2 }
  return (label, prompt) => {
    if (label.startsWith('completion-check:')) return 'MISSING'
    if (label.startsWith('lane-intake:')) {
      return batch({ 'lane-spec': JSON.stringify(specSummary) + '\n', 'lane-spec-bytes': '321\n', 'lane-spec-sha': `${SPEC_SHA}\n`, history: '', cleanup: '', 'skeleton-gen': '{}' })
    }
    if (label.startsWith('red:')) {
      return { ...witness, success: true, tests_pass: false, committed: true, commit_sha: 'aaa111', files_written: [testFile], test_exit_code: 1, test_errors: ['AttributeError'] }
    }
    if (label.startsWith('post-red:')) {
      const steps: Record<string, string> = {
        'count-gate': '{"new_test_count":2,"required":2,"passed":true}',
        'assert-check': '',
      }
      if (/git -C "\/wt\/T1" diff --name-only HEAD~1 HEAD/.test(prompt)) steps.ownership = `${testFile}\n`
      steps['scope-read-0'] = o.pytest
        ? 'def test_a():\n    assert 1\n\ndef test_b():\n    assert 2\n'
        : 'it("a", () => { expect(1).toBe(1) })\nit("b", () => { expect(2).toBe(2) })\n'
      steps['test-count-pattern'] = 'def test_|async def test_\n'
      steps['test-count-after'] = '2\n'
      steps['test-count-before'] = '0\n'
      return batch(steps)
    }
    if (label.startsWith('ownership-check:')) {
      // Legacy-mode ownership is the same one-step batch as the deterministic
      // post-RED/post-GREEN read: the diff's stdout, not a typed-back JSON list.
      return batch({ ownership: `${label.endsWith(':GREEN') ? implFile : testFile}\n` })
    }
    if (label.startsWith('scope-contract:')) {
      return batch({ 'contract-preflight': '{"status":"ok","conflicts":[],"needs_write":[],"reason":""}' })
    }
    if (label.startsWith('reflect:')) return { ...witness, score: 8, reasoning: 'covers both ACs', gaps: [] }
    if (label.startsWith('green:')) {
      return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'bbb222', files_written: [implFile], test_exit_code: 0 }
    }
    if (label.startsWith('post-green-verify:')) return batch({ ownership: '', 'test-verify': 'TEST_EXIT=0\n' })
    if (label.startsWith('post-green:')) return batch({ ownership: `${implFile}\n` })
    if (label.startsWith('skeptic-')) return { ...witness, bugs_found: [], confidence: 0.9, verdict: 'PASS' }
    if (label.startsWith('refactor-check:')) return { should_refactor: false, reason: 'clean' }
    return null
  }
}

async function runLane(opts: {
  respond: Responder
  agentTypes: { agentTypes: boolean; hooksInstalled: boolean }
  pytest: boolean
}): Promise<{ calls: Call[]; result: { results: Record<string, { status: string; stage?: string; error?: string }> } }> {
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
  const testCommand = opts.pytest ? 'uv run pytest -q' : 'npx vitest run'
  const files = opts.pytest ? ['tests/test_a.py', 'src/a.py'] : ['src/a.test.ts', 'src/a.ts']
  // The runner receives the DIGEST: files/deps/spec_hash, no acceptance criteria.
  const args = {
    batchLaneIds: ['T1'],
    lanePlan: {
      schema_version: 1,
      lane_plan_sha: 'plan-sha',
      lanes: { T1: { title: 'lane one', files, reads: [], depends_on: [], spec_hash: laneSpecHash(fullLane(opts)) } },
      topological_order: ['T1'],
      total_lanes: 1,
    },
    worktreePaths: { T1: '/wt/T1' },
    cfg: { lanePlanPath: 'docs/epics/e/lane-plan.json', epicBranch: 'e', runId: 'r1', testCommand, language: opts.pytest ? 'python' : 'typescript', agentTypes: opts.agentTypes },
    priorFailures: [],
    priorCompleted: [],
    batchTag: '',
  }
  const result = await script(agent, parallel, () => undefined, () => undefined, args, async () => ({}), { total: null, spent: () => 0, remaining: () => 0 })
  return { calls, result: result as { results: Record<string, { status: string; stage?: string; error?: string }> } }
}

const cliCalls = (calls: Call[]) => calls.filter((c) => c.agentType === 'datum-cli')
const readerCalls = (calls: Call[]) => calls.filter((c) => c.agentType === 'datum-reader')
/** Pure file reads that ride on datum-reader (refactor-check is a reader too, but an LLM judge). */
const PURE_READS = new Set(['completion-check', 'skeleton-read', 'read-plan'])
/** Command-runner calls (datum-cli + pure datum-reader reads) in call order, by label prefix. */
const runnerLabels = (calls: Call[]) =>
  calls
    .filter((c) => c.agentType === 'datum-cli' || (c.agentType === 'datum-reader' && PURE_READS.has(c.label.split(':')[0])))
    .map((c) => c.label.split(':')[0])

describe('#368 — lane command-runner calls, counted against a fake agent()', () => {
  it('completes the lane on the happy path (fixture sanity)', async () => {
    const { result } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: true })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(result.results.T1.stage).toBe('REFACTOR')
  })

  it('hooks not installed (legacy checks): ≤ 7 command-runner calls for a pytest lane', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: true })
    expect(runnerLabels(calls)).toEqual([
      'completion-check', 'lane-intake', 'post-red', 'ownership-check', 'scope-contract', 'post-green-verify', 'ownership-check',
    ])
    // The independent GREEN test-verify step (#386) is not gated behind
    // deterministicChecks() — it runs whenever GREEN ran, hooks or no hooks.
    expect(cliCalls(calls)).toHaveLength(6)
    expect(readerCalls(calls).map((c) => c.label.split(':')[0])).toEqual(['completion-check', 'refactor-check'])
  })

  it('hooks not installed: a TypeScript lane skips the scope/contract batch (5 runner calls)', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(runnerLabels(calls)).toEqual(['completion-check', 'lane-intake', 'post-red', 'ownership-check', 'post-green-verify', 'ownership-check'])
  })

  it('hooks installed (deterministic checks): 4 command-runner calls for a pytest lane, none of them LLM checks', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: true })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(runnerLabels(calls)).toEqual(['lane-intake', 'post-red', 'scope-contract', 'post-green-verify', 'post-green'])
    expect(calls.some((c) => c.label.startsWith('ownership-check:'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('completion-check:'))).toBe(false)
    // the ownership read rides inside the post-RED / post-GREEN batches
    expect(calls.find((c) => c.label.startsWith('post-red:'))!.prompt).toContain('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
    expect(calls.find((c) => c.label.startsWith('post-green:'))!.prompt).toContain('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
    // the cross-run completion read rides inside the intake batch
    expect(calls.find((c) => c.label.startsWith('lane-intake:'))!.prompt).toContain('.datum/runs/r1/lane-state/T1.json')
  })

  it('hooks installed: a TypeScript lane needs only 4 command-runner calls', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(runnerLabels(calls)).toEqual(['lane-intake', 'post-red', 'post-green-verify', 'post-green'])
  })

  it('hooks installed but agent_types off: the LLM checks stay (the hooks only fire through agentType)', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: false, hooksInstalled: true }, pytest: false })
    const labels = calls.map((c) => c.label.split(':')[0])
    expect(labels).toContain('completion-check')
    expect(labels.filter((l) => l === 'ownership-check')).toHaveLength(2)
    expect(labels).not.toContain('post-green')
  })

  it('deterministic ownership: a GREEN commit touching a FOREIGN file fails the lane with file_ownership_violation', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (label.startsWith('post-green:') ? batch({ ownership: 'src/a.ts\nsrc/other.ts\n' }) : base(label, prompt))
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/file_ownership_violation: .*src\/other\.ts/)
    expect(calls.some((c) => c.label.startsWith('skeptic-'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('green-tests-retry:'))).toBe(false)
  })

  it('deterministic ownership: a GREEN commit touching its own test file is green_edited_tests, and stops there when the reset for the retry cannot be confirmed', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (label.startsWith('post-green:') ? batch({ ownership: 'src/a.ts\nsrc/a.test.ts\n' }) : base(label, prompt))
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/^green_edited_tests: GREEN modified the lane's test files \[src\/a\.test\.ts\].*could not reset for the retry/)
    expect(calls.some((c) => c.label.startsWith('skeptic-'))).toBe(false)
  })

  it('deterministic completion: a marker from a prior run skips the lane after the intake batch', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (
      label.startsWith('lane-intake:')
        ? batch({ completion: '{"task_id": "T1", "status": "completed"}', history: '', cleanup: '', 'skeleton-gen': '{}' })
        : base(label, prompt)
    )
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('skipped')
    expect(result.results.T1.error).toMatch(/cross-run completion/)
    expect(calls.map((c) => c.label.split(':')[0])).toEqual(['lane-intake'])
  })

  it('every LLM stage carries its datum-* agentType', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: true })
    const byLabel = (prefix: string) => calls.filter((c) => c.label.startsWith(prefix)).map((c) => c.agentType)
    expect(byLabel('red:')).toEqual(['datum-red'])
    expect(byLabel('green:')).toEqual(['datum-green'])
    expect(byLabel('reflect:')).toEqual(['datum-reflect'])
    expect(byLabel('skeptic-')).toEqual(['datum-skeptic', 'datum-skeptic', 'datum-skeptic'])
    expect(byLabel('refactor-check:')).toEqual(['datum-reader'])
    expect(calls.every((c) => typeof c.agentType === 'string')).toBe(true)
  })

  it('agent_types off: no call carries an agentType, behaviour otherwise unchanged', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: false, hooksInstalled: true }, pytest: true })
    expect(result.results.T1.status).toBe('completed')
    expect(calls.every((c) => c.agentType === undefined)).toBe(true)
    expect(calls.length).toBeGreaterThan(5)
  })

  it('the batched post-RED checks are evaluated in the script: a count-gate miss fails RED', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('post-red:')) {
        return batch({
          'count-gate': '{"new_test_count":1,"required":2,"passed":false}',
          'assert-check': '', 'scope-read-0': 'it("a", () => {})', 'test-count-pattern': 'x', 'test-count-after': '1\n', 'test-count-before': '0\n',
        })
      }
      return base(label, prompt)
    }
    const { calls, result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('RED')
    expect(result.results.T1.error).toMatch(/no_new_test_functions_committed: found 1, need >= 2/)
    expect(calls.some((c) => c.label.startsWith('green:'))).toBe(false)
  })

  it('a placeholder assertion found by the batched scan fails RED with the grep detail', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('post-red:')) {
        return batch({
          'count-gate': '{"new_test_count":2,"required":2,"passed":true}',
          'assert-check': '3:  expect(true).toBe(false)\n', 'scope-read-0': 'x', 'test-count-pattern': 'x', 'test-count-after': '2\n', 'test-count-before': '0\n',
        })
      }
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/placeholder_assertions: 3:  expect\(true\)\.toBe\(false\)/)
  })

  it('a batch that returns nothing for the count gate is reported as tooling failure, not "0 tests" (#315)', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (label.startsWith('post-red:') ? null : base(label, prompt))
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/count_gate_no_output/)
  })

  // -------------------------------------------------------------------------
  // Ownership check must fail closed. A null/unparseable ownership-check
  // result must fail the lane with ownership_check_failed, never sail through
  // as ok:true.
  // -------------------------------------------------------------------------

  it('a null ownership-check result at RED fails the lane with ownership_check_failed, not a silent pass', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (label.startsWith('ownership-check:') ? null : base(label, prompt))
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('RED')
    expect(result.results.T1.error).toMatch(/^ownership_check_failed:/)
  })

  it('an unparseable ownership-check result (not a batch result) also fails closed', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (label.startsWith('ownership-check:') ? 'not json at all' : base(label, prompt))
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/^ownership_check_failed:/)
  })

  it('legacy ownership-check is a batch running the same diff command as the deterministic path — never a typed-back files_changed list', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    const checks = calls.filter((c) => c.label.startsWith('ownership-check:'))
    expect(checks).toHaveLength(2)
    for (const c of checks) {
      expect(c.prompt).toContain('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
      expect(c.prompt).not.toContain('files_changed')
    }
  })

  it('legacy ownership-check: a RED diff that touched an impl file is a file_ownership_violation from the batch stdout', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (label === 'ownership-check:T1:RED' ? batch({ ownership: 'src/a.test.ts\nsrc/a.ts\n' }) : base(label, prompt))
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('RED')
    expect(result.results.T1.error).toMatch(/file_ownership_violation/)
  })

  // -------------------------------------------------------------------------
  // Lane spec as a worktree file: the intake batch runs datum lane-spec-export,
  // the stage prompts point at the file, and a result without the read
  // witness fails the lane as context_read_unverified.
  // -------------------------------------------------------------------------

  it('intake runs datum lane-spec-export with the digest hash; RED/GREEN/reflect/skeptic prompts carry the file path, blob sha and the witness demand, never the criteria', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const intake = calls.find((c) => c.label.startsWith('lane-intake:'))!
    expect(intake.prompt).toContain(`datum lane-spec-export --plan "/wt/T1/.datum/lane-plan.json" --task "T1" --out "${SPEC_PATH}" --expect-hash "${laneSpecHash(fullLane({ pytest: false }))}"`)
    expect(intake.prompt).not.toMatch(/jq -c --arg id/)
    for (const prefix of ['red:', 'green:', 'reflect:', 'skeptic-']) {
      const call = calls.find((c) => c.label.startsWith(prefix))!
      expect(call.prompt, prefix).toContain(SPEC_PATH)
      // The sha is the witness: a prompt that printed it would let the agent copy it.
      expect(call.prompt, prefix).not.toContain(SPEC_SHA.slice(0, 12))
      expect(call.prompt, prefix).toMatch(/MANDATORY READ WITNESS/)
      expect(call.prompt, prefix).not.toContain('does a')
    }
    const red = calls.find((c) => c.label.startsWith('red:'))!
    expect(red.prompt).toContain(`"lane_spec_file":{"path":"${SPEC_PATH}","bytes":321}`)
    expect(red.prompt).not.toContain('"acceptance_criteria"')
  })

  it('a RED result without the read witness fails the lane as context_read_unverified before any gate', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('red:')) return { success: true, tests_pass: false, committed: true, commit_sha: 'aaa111', files_written: ['src/a.test.ts'], test_exit_code: 1 }
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('RED')
    expect(result.results.T1.error).toMatch(/^context_read_unverified: \/wt\/T1\/\.datum\/lane-spec\.json/)
    expect(calls.some((c) => c.label.startsWith('post-red:'))).toBe(false)
  })

  it('a forged witness (wrong sha prefix) on GREEN is context_read_unverified too', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('green:')) return { read_witness: { [SPEC_PATH]: 'deadbeefdead' }, success: true, tests_pass: true, committed: true, commit_sha: 'bbb222', files_written: ['src/a.ts'], test_exit_code: 0 }
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/^context_read_unverified: .*expected blob c0ffee/)
  })

  it('a lane-spec-export failure (hash mismatch) fails the lane by the CLI\'s own reason and dispatches no stage agent', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) return batch({ 'lane-spec': { exit_code: 1, stdout: '{"error":"lane_spec_hash_mismatch: T1 hashes to fnv1a64:2 but the digest says fnv1a64:1; the plan changed between digest and intake"}\n' }, 'lane-spec-bytes': { exit_code: 1 }, 'lane-spec-sha': { exit_code: 128 }, history: '' })
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/^lane_spec_export_failed: T1 — lane_spec_hash_mismatch: T1/)
    expect(calls.some((c) => c.label.startsWith('red:'))).toBe(false)
  })

  it('a post-RED batch missing the test-count-before step fails the lane as test_count_missing, never as "new tests verified"', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('post-red:')) {
        const arr = JSON.parse(base(label, prompt) as string) as Array<{ name: string }>
        return JSON.stringify(arr.filter((s) => s.name !== 'test-count-before'))
      }
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('RED')
    expect(result.results.T1.error).toMatch(/^test_count_missing: test-count-before/)
    expect(calls.some((c) => c.label.startsWith('reflect:'))).toBe(false)
  })

  // elonchesd wf_0593c210-f04 task-011: GREEN's diff included the lane's own
  // test file and the lane failed as "owned by another lane". That is
  // green_edited_tests: reset to RED, re-run GREEN once with the hint.
  it('a GREEN diff that touches the lane\'s own test file resets to RED and retries GREEN once as green_edited_tests', async () => {
    const base = happyPathResponder({ pytest: false })
    let postGreenCalls = 0
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('post-green:')) { postGreenCalls++; return batch({ ownership: 'src/a.ts\nsrc/a.test.ts\n' }) }
      if (label.startsWith('green-tests-reset:')) return batch({ reset: '', clean: '', status: '', head: 'aaa111\n' })
      if (label.startsWith('green-tests-retry:')) return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'ddd444', files_written: ['src/a.ts'], test_exit_code: 0 }
      if (label.startsWith('post-green-tests-retry-verify:')) return batch({ ownership: '', 'test-verify': 'TEST_EXIT=0\n' })
      if (label.startsWith('post-green-tests-retry:')) return batch({ ownership: 'src/a.ts\n' })
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const retry = calls.find((c) => c.label.startsWith('green-tests-retry:'))!
    expect(retry.prompt).toMatch(/green_edited_tests: GREEN modified the lane's test files \[src\/a\.test\.ts\]/)
    expect(calls.some((c) => c.label.startsWith('green-tests-reset:'))).toBe(true)
    expect(postGreenCalls).toBe(1)
  })

  it('a GREEN that touches its test file again on the retry fails the lane as green_edited_tests, never "owned by another lane"', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('post-green:') || label.startsWith('post-green-tests-retry:')) return batch({ ownership: 'src/a.ts\nsrc/a.test.ts\n' })
      if (label.startsWith('green-tests-reset:')) return batch({ reset: '', clean: '', status: '', head: 'aaa111\n' })
      if (label.startsWith('green-tests-retry:')) return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'ddd444', files_written: ['src/a.ts'], test_exit_code: 0 }
      if (label.startsWith('post-green-tests-retry-verify:')) return batch({ ownership: '', 'test-verify': 'TEST_EXIT=0\n' })
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/^green_edited_tests: GREEN modified test files again on retry \[src\/a\.test\.ts\]/)
    expect(result.results.T1.error).not.toMatch(/another lane/)
  })

  // elonchesd wf_0593c210-f04: identical batches, one allowed, two refused by
  // the host classifier. A refused batch is re-sent once to a fresh runner.
  it('a runner refusal on the intake batch is retried once with a fresh runner label before the lane fails', async () => {
    const base = happyPathResponder({ pytest: false })
    let intakeCalls = 0
    const respond: Responder = (label, prompt) => {
      if (label === 'lane-intake:T1') { intakeCalls++; return 'The permission classifier blocked execution of this script.' }
      if (label === 'lane-intake:T1:retry') { intakeCalls++; return base('lane-intake:T1', prompt) }
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(intakeCalls).toBe(2)
  })

  it('two refusals in a row fail the lane as runner_permission_denied', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) return 'Bash was blocked by the auto-mode classifier due to permission restrictions.'
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/lane_intake_failed: .*runner_permission_denied/)
  })

  // -------------------------------------------------------------------------
  // Skeptic verdict consumption: a cross-validated BROKEN verdict must retry
  // GREEN once with the confirmed bugs, then independently re-verify.
  // -------------------------------------------------------------------------

  it('a cross-validated BROKEN skeptic verdict retries GREEN once with confirmed bugs, then completes if the retry verdict is clean', async () => {
    const base = happyPathResponder({ pytest: false })
    let skepticCalls = 0
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('skeptic-')) {
        skepticCalls++
        if (skepticCalls <= 3) {
          return { ...witness, bugs_found: [{ description: 'off-by-one in loop bound', evidence: 'line 12', severity: 'high' }], confidence: 0.9, verdict: 'BROKEN' }
        }
        return { ...witness, bugs_found: [], confidence: 0.9, verdict: 'PASS' }
      }
      if (label.startsWith('green-skeptic-retry:')) {
        return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'ccc333', files_written: ['src/a.ts'], test_exit_code: 0 }
      }
      if (label.startsWith('post-green-skeptic-retry-verify:')) return batch({ ownership: '', 'test-verify': 'TEST_EXIT=0\n' })
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const retryCall = calls.find((c) => c.label.startsWith('green-skeptic-retry:'))
    expect(retryCall).toBeDefined()
    expect(retryCall!.prompt).toMatch(/SKEPTIC FINDINGS/)
    expect(retryCall!.prompt).toMatch(/off-by-one in loop bound/)
    // Skeptic panel ran twice (3 lenses each): once after GREEN, once after the retry.
    expect(skepticCalls).toBe(6)
  })

  it('a skeptic verdict still BROKEN after the retry fails the lane with skeptic_broken', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('skeptic-')) {
        return { ...witness, bugs_found: [{ description: 'off-by-one in loop bound', evidence: 'line 12', severity: 'high' }], confidence: 0.9, verdict: 'BROKEN' }
      }
      if (label.startsWith('green-skeptic-retry:')) {
        return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'ccc333', files_written: ['src/a.ts'], test_exit_code: 0 }
      }
      if (label.startsWith('post-green-skeptic-retry-verify:')) return batch({ ownership: '', 'test-verify': 'TEST_EXIT=0\n' })
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/^skeptic_broken: \d+ confirmed bugs — off-by-one in loop bound/)
  })

  it('a skeptic retry whose independent test-verify still fails also fails the lane with skeptic_broken', async () => {
    const base = happyPathResponder({ pytest: false })
    let skepticCalls = 0
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('skeptic-')) {
        skepticCalls++
        return { ...witness, bugs_found: [{ description: 'off-by-one in loop bound', evidence: 'line 12', severity: 'high' }], confidence: 0.9, verdict: 'BROKEN' }
      }
      if (label.startsWith('green-skeptic-retry:')) {
        return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'ccc333', files_written: ['src/a.ts'], test_exit_code: 0 }
      }
      if (label.startsWith('post-green-skeptic-retry-verify:')) return batch({ ownership: '', 'test-verify': 'TEST_EXIT=1\n' })
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/^skeptic_broken:/)
    // Only one skeptic pass ran — the retry never got a second skeptic check
    // because independent test-verify already failed it.
    expect(skepticCalls).toBe(3)
  })
})
