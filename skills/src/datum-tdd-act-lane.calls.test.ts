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

function happyPathResponder(o: { pytest: boolean }): Responder {
  const testFile = o.pytest ? 'tests/test_a.py' : 'src/a.test.ts'
  const implFile = o.pytest ? 'src/a.py' : 'src/a.ts'
  return (label, prompt) => {
    if (label.startsWith('completion-check:')) return 'MISSING'
    if (label.startsWith('lane-intake:')) {
      return batch({ history: '', cleanup: '', 'skeleton-gen': '{}' })
    }
    if (label.startsWith('red:')) {
      return { success: true, tests_pass: false, committed: true, commit_sha: 'aaa111', files_written: [testFile], test_exit_code: 1, test_errors: ['AttributeError'] }
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
      return JSON.stringify({ files_changed: [label.endsWith(':GREEN') ? implFile : testFile] })
    }
    if (label.startsWith('scope-contract:')) {
      return batch({ 'contract-preflight': '{"status":"ok","conflicts":[],"needs_write":[],"reason":""}' })
    }
    if (label.startsWith('reflect:')) return { score: 8, reasoning: 'covers both ACs', gaps: [] }
    if (label.startsWith('green:')) {
      return { success: true, tests_pass: true, committed: true, commit_sha: 'bbb222', files_written: [implFile], test_exit_code: 0 }
    }
    if (label.startsWith('post-green:')) return batch({ ownership: `${implFile}\n` })
    if (label.startsWith('skeptic-')) return { bugs_found: [], confidence: 0.9, verdict: 'PASS' }
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
  const args = {
    batchLaneIds: ['T1'],
    lanePlan: {
      lanes: { T1: { title: 'lane one', files, acceptance_criteria: ['does a', 'does b'] } },
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

  it('hooks not installed (legacy checks): ≤ 6 command-runner calls for a pytest lane', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: true })
    expect(runnerLabels(calls)).toEqual([
      'completion-check', 'lane-intake', 'post-red', 'ownership-check', 'scope-contract', 'ownership-check',
    ])
    expect(cliCalls(calls)).toHaveLength(5)
    expect(readerCalls(calls).map((c) => c.label.split(':')[0])).toEqual(['completion-check', 'refactor-check'])
  })

  it('hooks not installed: a TypeScript lane skips the scope/contract batch (5 runner calls)', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(runnerLabels(calls)).toEqual(['completion-check', 'lane-intake', 'post-red', 'ownership-check', 'ownership-check'])
  })

  it('hooks installed (deterministic checks): 4 command-runner calls for a pytest lane, none of them LLM checks', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: true })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(runnerLabels(calls)).toEqual(['lane-intake', 'post-red', 'scope-contract', 'post-green'])
    expect(calls.some((c) => c.label.startsWith('ownership-check:'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('completion-check:'))).toBe(false)
    // the ownership read rides inside the post-RED / post-GREEN batches
    expect(calls.find((c) => c.label.startsWith('post-red:'))!.prompt).toContain('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
    expect(calls.find((c) => c.label.startsWith('post-green:'))!.prompt).toContain('git -C "/wt/T1" diff --name-only HEAD~1 HEAD')
    // the cross-run completion read rides inside the intake batch
    expect(calls.find((c) => c.label.startsWith('lane-intake:'))!.prompt).toContain('.datum/runs/r1/lane-state/T1.json')
  })

  it('hooks installed: a TypeScript lane needs only 3 command-runner calls', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(runnerLabels(calls)).toEqual(['lane-intake', 'post-red', 'post-green'])
  })

  it('hooks installed but agent_types off: the LLM checks stay (the hooks only fire through agentType)', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: false, hooksInstalled: true }, pytest: false })
    const labels = calls.map((c) => c.label.split(':')[0])
    expect(labels).toContain('completion-check')
    expect(labels.filter((l) => l === 'ownership-check')).toHaveLength(2)
    expect(labels).not.toContain('post-green')
  })

  it('deterministic ownership: a GREEN commit touching a test file fails the lane with file_ownership_violation', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => (label.startsWith('post-green:') ? batch({ ownership: 'src/a.ts\nsrc/a.test.ts\n' }) : base(label, prompt))
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/file_ownership_violation: .*src\/a\.test\.ts/)
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
})
