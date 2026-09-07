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
import { utf8Encode } from './shared/utf8'
import { gitBlobSha } from './shared/sha1'

const bundlePath = join(__dirname, '..', 'datum-tdd-act-lane.js')

interface Call { label: string; agentType?: string; prompt: string; worktree?: string }

type Responder = (label: string, prompt: string) => unknown


/** The bytes a writeFileSteps heredoc puts on disk (content + one trailing newline). */
function extractHeredoc(prompt: string): string {
  const m = /<<'DATUM_WRITE_EOF'\n([\s\S]*?)\nDATUM_WRITE_EOF/.exec(prompt)
  if (!m) throw new Error('no heredoc in prompt')
  return m[1] + '\n'
}

/** JSON array a batched datum-cli script would print. */
function batch(steps: Record<string, string | { stdout?: string; exit_code?: number }>): string {
  return JSON.stringify(Object.entries(steps).map(([name, v]) => (
    typeof v === 'string'
      ? { name, exit_code: 0, stdout: v, stderr: '' }
      : { name, exit_code: v.exit_code ?? 0, stdout: v.stdout ?? '', stderr: '' }
  )))
}

/** A batch reply the fake agent must hand over as-is (a deliberately partial array). */
function partialBatch(json: string): { partialBatch: string } {
  return { partialBatch: json }
}

/**
 * A real script records every step (the parser now names a short array
 * batch_incomplete, #341 task-008). Responders name only the steps a test
 * cares about; the fake agent fills the rest from the script's own
 * `# step i/N: name` lines with exit 0 and empty output, in script order.
 */
function completeBatch(reply: unknown, prompt: string): unknown {
  if (reply && typeof reply === 'object' && 'partialBatch' in reply) return (reply as { partialBatch: string }).partialBatch
  if (typeof reply !== 'string' || !reply.trim().startsWith('[')) return reply
  let arr: Array<{ name: string; exit_code: number; stdout: string; stderr: string }>
  try { arr = JSON.parse(reply) } catch { return reply }
  const names = [...prompt.matchAll(/^# step \d+\/\d+: (\S+)/gm)].map((m) => m[1])
  if (names.length === 0) return reply
  const given = new Map(arr.map((r) => [r.name, r]))
  const ordered = names.map((n) => given.get(n) ?? { name: n, exit_code: 0, stdout: '', stderr: '' })
  for (const r of arr) if (!names.includes(r.name)) ordered.push(r)
  return JSON.stringify(ordered)
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
      if (/git -C "\/wt\/T1" diff --name-only .+ HEAD/.test(prompt)) steps.ownership = `${testFile}\n`
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
    if (label.startsWith('post-green-verify:')) return batch({ ownership: '', 'stray-list': '', 'stray-clean': '', 'stray-confirm': '', 'test-verify': 'TEST_EXIT=0\n' })
    if (label.startsWith('stray-clean:')) return batch({ 'stray-list': '', 'stray-clean': '', 'stray-confirm': '' })
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
  logs?: string[]
}): Promise<{ calls: Call[]; result: { results: Record<string, { status: string; stage?: string; error?: string; follow_ups?: number }> } }> {
  const bundle = readFileSync(bundlePath, 'utf8')
  const body = bundle.replace(/^export const meta = /m, 'const meta = ')
  const AsyncFunction = Object.getPrototypeOf(async function () { /* */ }).constructor as new (...a: string[]) => (...b: unknown[]) => Promise<unknown>
  const script = new AsyncFunction('agent', 'parallel', 'phase', 'log', 'args', 'workflow', 'budget', body)

  const calls: Call[] = []
  const agent = async (prompt: string, o?: { label?: string; agentType?: string; worktree?: string }) => {
    const label = o?.label || ''
    calls.push({ label, agentType: o?.agentType, prompt, worktree: o?.worktree })
    return completeBatch(opts.respond(label, prompt), prompt)
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
  const result = await script(agent, parallel, () => undefined, (m: string) => { if (opts.logs) opts.logs.push(m) }, args, async () => ({}), { total: null, spent: () => 0, remaining: () => 0 })
  return { calls, result: result as { results: Record<string, { status: string; stage?: string; error?: string; follow_ups?: number }> } }
}

const cliCalls = (calls: Call[]) => calls.filter((c) => c.agentType === 'datum-cli')
const readerCalls = (calls: Call[]) => calls.filter((c) => c.agentType === 'datum-reader')
/** Pure file reads that ride on datum-reader. refactor-check used to ride
 *  here too, but it is an LLM judge over every file the lane touched, not a
 *  one-file read — it now runs as datum-quality-reader (prompts audit
 *  20260906, batch 2 item 10). */
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

  it('hooks not installed (legacy checks): ≤ 8 command-runner calls for a pytest lane', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: true })
    expect(runnerLabels(calls)).toEqual([
      'completion-check', 'lane-intake', 'post-red', 'ownership-check', 'scope-contract', 'post-green-verify', 'ownership-check', 'stray-clean',
    ])
    // The independent GREEN test-verify step (#386) is not gated behind
    // deterministicChecks() — it runs whenever GREEN ran, hooks or no hooks.
    // stray-clean (caliper wf_fa38ac24-890) runs before REFACTOR the same way.
    expect(cliCalls(calls)).toHaveLength(7)
    expect(readerCalls(calls).map((c) => c.label.split(':')[0])).toEqual(['completion-check'])
    expect(calls.filter((c) => c.agentType === 'datum-quality-reader').map((c) => c.label.split(':')[0])).toEqual(['refactor-check'])
  })

  it('hooks not installed: a TypeScript lane skips the scope/contract batch (7 runner calls)', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: false })
    expect(runnerLabels(calls)).toEqual(['completion-check', 'lane-intake', 'post-red', 'ownership-check', 'post-green-verify', 'ownership-check', 'stray-clean'])
  })

  it('hooks installed (deterministic checks): 6 command-runner calls for a pytest lane, none of them LLM checks', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: true })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(runnerLabels(calls)).toEqual(['lane-intake', 'post-red', 'scope-contract', 'post-green-verify', 'post-green', 'stray-clean'])
    expect(calls.some((c) => c.label.startsWith('ownership-check:'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('completion-check:'))).toBe(false)
    // the ownership read rides inside the post-RED / post-GREEN batches
    // RED's diff starts at the lane start (merge-base with the epic); GREEN's at the RED commit.
    expect(calls.find((c) => c.label.startsWith('post-red:'))!.prompt).toMatch(/git -C "\/wt\/T1" diff --name-only "\$\(git -C "\/wt\/T1" merge-base HEAD "[^"]+"\)" HEAD/)
    expect(calls.find((c) => c.label.startsWith('post-green:'))!.prompt).toContain('git -C "/wt/T1" diff --name-only aaa111 HEAD')
    // the cross-run completion read rides inside the intake batch
    expect(calls.find((c) => c.label.startsWith('lane-intake:'))!.prompt).toContain('.datum/runs/r1/lane-state/T1.json')
  })

  it('hooks installed: a TypeScript lane needs only 5 command-runner calls', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(runnerLabels(calls)).toEqual(['lane-intake', 'post-red', 'post-green-verify', 'post-green', 'stray-clean'])
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
    const respond: Responder = (label, prompt) => (label.startsWith('post-green:') ? batch({ ownership: 'src/a.ts\nsrc/a.test.ts\n', 'red-files': 'src/a.test.ts\n' }) : base(label, prompt))
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
    expect(byLabel('refactor-check:')).toEqual(['datum-quality-reader'])
    expect(calls.every((c) => typeof c.agentType === 'string')).toBe(true)
  })

  it('every skeptic lens dispatch carries the lane worktree, so its tools resolve paths there and not in the main checkout (#349)', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: true })
    const skepticCalls = calls.filter((c) => c.label.startsWith('skeptic-'))
    expect(skepticCalls.length).toBeGreaterThan(0)
    for (const c of skepticCalls) expect(c.worktree).toBe('/wt/T1')
  })

  it('agent_types off: no call carries an agentType, behaviour otherwise unchanged', async () => {
    const { calls, result } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: false, hooksInstalled: true }, pytest: true })
    expect(result.results.T1.status).toBe('completed')
    expect(calls.every((c) => c.agentType === undefined)).toBe(true)
    expect(calls.length).toBeGreaterThan(5)
  })

  it('a pytest lane\'s test-function pattern credits @pytest.mark.parametrize( and @given( decorators, not just def test_/async def test_ (#371)', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: true }), agentTypes: { agentTypes: true, hooksInstalled: false }, pytest: true })
    const postRed = calls.find((c) => c.label.startsWith('post-red:'))!
    expect(postRed.prompt).toContain('def test_')
    expect(postRed.prompt).toContain('async def test_')
    expect(postRed.prompt).toContain('@pytest\\.mark\\.parametrize\\(')
    expect(postRed.prompt).toContain('@given\\(')
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
      expect(c.prompt).toMatch(/git -C "\/wt\/T1" diff --name-only .+ HEAD/)
      expect(c.prompt).not.toContain('HEAD~1')
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

  // ---------------------------------------------------------------------------
  // #493 — the skeptic panel reasons against PROPERTIES.md too (FLOW.md's Act
  // handoff). Folded into the SAME lane-intake batch: no second command-runner
  // call, just three more named steps evaluated by propertiesFromSteps.
  // ---------------------------------------------------------------------------

  // Worktree-relative — the batch's cwd is the ROOT checkout, not
  // guaranteed to be on the epic branch, so the path is anchored at /wt/T1.
  const PROPERTIES_PATH = '/wt/T1/docs/epics/e/PROPERTIES.md'

  it('lane-intake stays ONE batch call and probes PROPERTIES.md by size and blob sha alongside the lane spec', async () => {
    const { calls } = await runLane({ respond: happyPathResponder({ pytest: false }), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(calls.filter((c) => c.label.startsWith('lane-intake:')).length).toBe(1)
    const intake = calls.find((c) => c.label.startsWith('lane-intake:'))!
    expect(intake.prompt).toContain(`wc -c < "${PROPERTIES_PATH}"`)
    expect(intake.prompt).toContain(`git hash-object "${PROPERTIES_PATH}"`)
    expect(intake.prompt).toContain(`cat "${PROPERTIES_PATH}"`)
  })

  it('an epic with no PROPERTIES.md gives the skeptic panel a one-line sentence, not a Read instruction', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) {
        return batch({ 'lane-spec': JSON.stringify({ task_id: 'T1', path: SPEC_PATH, bytes: 321, sha: SPEC_SHA, spec_hash: laneSpecHash(fullLane({ pytest: false })), ac_count: 2 }) + '\n', 'lane-spec-bytes': '321\n', 'lane-spec-sha': `${SPEC_SHA}\n`, 'properties-bytes': '-1', 'properties-sha': '', 'properties-cat': '__DATUM_PROPERTIES_DEFERRED__', history: '', cleanup: '', 'skeleton-gen': '{}' })
      }
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const skeptic = calls.find((c) => c.label.startsWith('skeptic-'))!
    expect(skeptic.prompt).toContain('PROPERTIES.md does not exist for this epic')
    expect(skeptic.prompt).not.toContain(PROPERTIES_PATH)
  })

  it('a small PROPERTIES.md is inlined verbatim into the skeptic prompt', async () => {
    const content = '## Correctness\n- an invariant\n'
    const bytes = utf8Encode(content).length
    const sha = gitBlobSha(utf8Encode(content))
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) {
        return batch({ 'lane-spec': JSON.stringify({ task_id: 'T1', path: SPEC_PATH, bytes: 321, sha: SPEC_SHA, spec_hash: laneSpecHash(fullLane({ pytest: false })), ac_count: 2 }) + '\n', 'lane-spec-bytes': '321\n', 'lane-spec-sha': `${SPEC_SHA}\n`, 'properties-bytes': `${bytes}\n`, 'properties-sha': `${sha}\n`, 'properties-cat': content, history: '', cleanup: '', 'skeleton-gen': '{}' })
      }
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const skeptic = calls.find((c) => c.label.startsWith('skeptic-'))!
    expect(skeptic.prompt).toContain(content)
  })

  it('an over-budget PROPERTIES.md is deferred: the skeptic prompt gets path + bytes + a mandatory witnessed Read, and a lens without that witness is dropped', async () => {
    const bigBytes = 20000
    const bigSha = 'd'.repeat(40)
    const base = happyPathResponder({ pytest: false })
    let skepticCalls = 0
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) {
        return batch({ 'lane-spec': JSON.stringify({ task_id: 'T1', path: SPEC_PATH, bytes: 321, sha: SPEC_SHA, spec_hash: laneSpecHash(fullLane({ pytest: false })), ac_count: 2 }) + '\n', 'lane-spec-bytes': '321\n', 'lane-spec-sha': `${SPEC_SHA}\n`, 'properties-bytes': `${bigBytes}\n`, 'properties-sha': `${bigSha}\n`, 'properties-cat': '__DATUM_PROPERTIES_DEFERRED__', history: '', cleanup: '', 'skeleton-gen': '{}' })
      }
      if (label.startsWith('skeptic-')) {
        skepticCalls++
        // Only two of three lenses carry a witness for PROPERTIES.md — the panel still passes on the majority.
        if (skepticCalls === 1) return { read_witness: { [SPEC_PATH]: SPEC_SHA.slice(0, 12) }, bugs_found: [], confidence: 0.9, verdict: 'PASS' }
        return { read_witness: { [SPEC_PATH]: SPEC_SHA.slice(0, 12), [PROPERTIES_PATH]: bigSha.slice(0, 12) }, bugs_found: [], confidence: 0.9, verdict: 'PASS' }
      }
      return base(label, prompt)
    }
    const logs: string[] = []
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false, logs })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const skepticPrompts = calls.filter((c) => c.label.startsWith('skeptic-'))
    for (const c of skepticPrompts) {
      expect(c.prompt).toContain(PROPERTIES_PATH)
      expect(c.prompt).toContain(`${bigBytes} bytes`)
      expect(c.prompt).toMatch(/MANDATORY READ WITNESS/)
      expect(c.prompt).not.toContain(bigSha.slice(0, 12))
    }
    expect(logs.some((l) => /skeptic_lens_unverified:/.test(l))).toBe(true)
  })

  // Design decision: a deferred PROPERTIES.md is witnessed with the SAME
  // rigor as the lane spec (verifyReadWitness requires every deferred file,
  // not just the majority) — a lens carrying only the spec witness is
  // dropped from the vote exactly as one carrying neither would be. If
  // every lens misses the properties witness the panel is void, same as
  // today's all-lenses-miss-the-spec-witness case.
  it('all three lenses missing the PROPERTIES.md witness voids the panel: context_read_unverified at GREEN', async () => {
    const bigBytes = 20000
    const bigSha = 'd'.repeat(40)
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) {
        return batch({ 'lane-spec': JSON.stringify({ task_id: 'T1', path: SPEC_PATH, bytes: 321, sha: SPEC_SHA, spec_hash: laneSpecHash(fullLane({ pytest: false })), ac_count: 2 }) + '\n', 'lane-spec-bytes': '321\n', 'lane-spec-sha': `${SPEC_SHA}\n`, 'properties-bytes': `${bigBytes}\n`, 'properties-sha': `${bigSha}\n`, 'properties-cat': '__DATUM_PROPERTIES_DEFERRED__', history: '', cleanup: '', 'skeleton-gen': '{}' })
      }
      // Every lens carries the spec witness but none carries the properties witness.
      if (label.startsWith('skeptic-')) return { read_witness: { [SPEC_PATH]: SPEC_SHA.slice(0, 12) }, bugs_found: [], confidence: 0.9, verdict: 'PASS' }
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/^context_read_unverified: .*PROPERTIES\.md/)
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
        // Deliberately short: the parser names it batch_incomplete (#341 task-008).
        return partialBatch(JSON.stringify(arr.filter((s) => s.name !== 'test-count-before')))
      }
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('RED')
    expect(result.results.T1.error).toMatch(/batch_incomplete: .*absent: \[.*test-count-before/)
    expect(calls.some((c) => c.label.startsWith('reflect:'))).toBe(false)
  })

  // elonchesd wf_0593c210-f04 task-011: GREEN's diff included the lane's own
  // test file and the lane failed as "owned by another lane". That is
  // green_edited_tests: reset to RED, re-run GREEN once with the hint.
  it('a GREEN diff that touches the lane\'s own test file resets to RED and retries GREEN once as green_edited_tests', async () => {
    const base = happyPathResponder({ pytest: false })
    let postGreenCalls = 0
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('post-green:')) { postGreenCalls++; return batch({ ownership: 'src/a.ts\nsrc/a.test.ts\n', 'red-files': 'src/a.test.ts\n' }) }
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
      if (label.startsWith('post-green:') || label.startsWith('post-green-tests-retry:')) return batch({ ownership: 'src/a.ts\nsrc/a.test.ts\n', 'red-files': 'src/a.test.ts\n' })
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

  // caliper#564: a single-lens critical/high finding is not a retry trigger,
  // but it is named in the log and written as a FollowUpIssue for Closeout.
  it('a single-lens high finding on a PASS panel is written to .datum/runs/<run>/follow-ups/<lane>.json and counted on the outcome', async () => {
    const base = happyPathResponder({ pytest: false })
    let skepticCalls = 0
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('skeptic-')) {
        skepticCalls++
        if (skepticCalls === 2) return { ...witness, bugs_found: [{ description: 'thresholds dropped on --serve path', evidence: 'part_cmd.py:345 calls serve_part before _apply_rename_thresholds at 368', severity: 'high' }], confidence: 0.8, verdict: 'FRAGILE' }
        return { ...witness, bugs_found: [], confidence: 0.9, verdict: 'PASS' }
      }
      if (label.startsWith('followups-write:')) {
        return batch({ mkdir: '', write: '', sha: `${gitBlobSha(utf8Encode(extractHeredoc(prompt)))}\n` })
      }
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(result.results.T1.follow_ups).toBe(1)
    const write = calls.find((c) => c.label.startsWith('followups-write:'))!
    expect(write.prompt).toContain('.datum/runs/r1/follow-ups/T1.json')
    expect(write.prompt).toContain('"dedup_key": "skeptic-minority:T1:bbb222:0"')
    expect(write.prompt).toContain('thresholds dropped on --serve path')
    expect(calls.some((c) => c.label.startsWith('green-skeptic-retry:'))).toBe(false)
  })

  // caliper wf_2f49073d-f07 (BUG K3): one haiku lens mangled its witness while
  // the other two verified — the lane must not fail on the unverifiable lens;
  // it is dropped from the vote by name.
  it('a skeptic lens without a verifiable witness is dropped from the vote (skeptic_lens_unverified), the lane completes', async () => {
    const base = happyPathResponder({ pytest: false })
    let skepticCalls = 0
    const logs: string[] = []
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('skeptic-')) {
        skepticCalls++
        if (skepticCalls === 2) return { bugs_found: [{ description: 'x', evidence: 'y', severity: 'high' }], confidence: 0.9, verdict: 'BROKEN' }
        return { ...witness, bugs_found: [], confidence: 0.9, verdict: 'PASS' }
      }
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false, logs })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(logs.some((l) => /skeptic_lens_unverified: T1 — lens error/.test(l))).toBe(true)
    expect(result.results.T1.follow_ups).toBeUndefined()
  })

  it('when no skeptic lens verifies its witness the lane fails as context_read_unverified at GREEN', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('skeptic-')) return { bugs_found: [], confidence: 0.9, verdict: 'PASS' }
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/^context_read_unverified: .*no skeptic lens evidenced reading/)
  })

  // caliper wf_2a6b91bb-bb4 (BUG L): a GREEN that stopped as {status:"blocked",
  // needs_write:[...]} had implemented three of four criteria; the lane
  // reported blocked, cleanup removed the worktree and the edits were gone.
  it('a blocked GREEN commits its partial implementation edits as a wip commit before the lane returns blocked', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('green:')) return { ...witness, success: false, tests_pass: false, committed: false, status: 'blocked', needs_write: ['tests/other.test.ts'], reason: 'a pre-existing strict assertion outside my files', files_written: ['src/a.ts'] }
      if (label.startsWith('green-wip-commit:')) return batch({ status: ' M src/a.ts\n', add: '', commit: '', sha: 'wip111\n' })
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('blocked')
    expect(result.results.T1.error).toMatch(/^green_blocked_needs_write: \[tests\/other\.test\.ts\]/)
    const wip = calls.find((c) => c.label.startsWith('green-wip-commit:'))!
    expect(wip.prompt).toContain('git -C "/wt/T1" add -- "src/a.ts"')
    expect(wip.prompt).toContain('wip(T1): GREEN partial - blocked on tests/other.test.ts')
  })

  // caliper wf_7fb1a1b8-252 (BUG M): the lane's files[] changed between runs
  // (spec_hash changed) but the RED committed under the old spec was reused.
  it('a RED commit whose Datum-Spec trailer differs from the current spec is reset away and RED re-dispatched (red_spec_stale)', async () => {
    const base = happyPathResponder({ pytest: false })
    const logs: string[] = []
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) {
        const arr = JSON.parse(base(label, prompt) as string) as Array<{ name: string; stdout: string }>
        for (const st of arr) if (st.name === 'history') st.stdout = 'aaa111 red(T1): RED complete\tfnv1a64:0000000000000old\n'
        return JSON.stringify(arr)
      }
      if (label.startsWith('red-spec-reset:')) return batch({ reset: '', clean: '', status: '', head: 'e'.repeat(40) + '\n', target: 'e'.repeat(40) + '\n' })
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false, logs })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(logs.some((l) => /red_spec_stale: T1 — RED commit aaa111 was made under spec fnv1a64:0000000000000old/.test(l))).toBe(true)
    const reset = calls.find((c) => c.label.startsWith('red-spec-reset:'))!
    expect(reset.prompt).toContain('git -C "/wt/T1" reset --hard "e"')
    expect(calls.some((c) => c.label === 'red:T1')).toBe(true)
    // The fresh RED commit records the current spec.
    const red = calls.find((c) => c.label === 'red:T1')!
    expect(red.prompt).toMatch(/-m "Datum-Spec: fnv1a64:[0-9a-f]{16}"/)
  })

  it('a RED commit with a matching Datum-Spec is reused (no reset, no RED dispatch)', async () => {
    const base = happyPathResponder({ pytest: false })
    const spec = laneSpecHash(fullLane({ pytest: false }))
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) {
        const arr = JSON.parse(base(label, prompt) as string) as Array<{ name: string; stdout: string }>
        for (const st of arr) if (st.name === 'history') st.stdout = `aaa111 red(T1): RED complete\t${spec}\n`
        return JSON.stringify(arr)
      }
      if (label.startsWith('verify-commit:') || label.startsWith('commit-check:')) return base(label, prompt)
      return base(label, prompt)
    }
    const { calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(calls.some((c) => c.label.startsWith('red-spec-reset:'))).toBe(false)
    expect(calls.some((c) => c.label === 'red:T1')).toBe(false)
  })

  // elonchesd wf_eb0f9f9b-7b1: a lane worktree without dependencies makes
  // every verify exit 1; that is test_env_missing, not a stale GREEN.
  it('an intake verify whose output says the test runner is missing fails the lane as test_env_missing, never green_stale', async () => {
    const base = happyPathResponder({ pytest: false })
    const spec = laneSpecHash(fullLane({ pytest: false }))
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('lane-intake:')) {
        const arr = JSON.parse(base(label, prompt) as string) as Array<{ name: string; stdout: string }>
        for (const st of arr) if (st.name === 'history') st.stdout = `bbb222 green(T1): GREEN complete\t${spec}\naaa111 red(T1): RED complete\t${spec}\n`
        return JSON.stringify(arr)
      }
      if (label.startsWith('lane-intake-verify:')) return batch({ 'test-verify': '> vitest run\n\nsh: vitest: command not found\n ELIFECYCLE Test failed.\nTEST_EXIT=1\n' })
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/^test_env_missing: sh: vitest: command not found/)
    expect(calls.some((c) => c.label.startsWith('reset-to-red:'))).toBe(false)
    expect(calls.some((c) => c.label.startsWith('green:'))).toBe(false)
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

// caliper BUG P (wf_b5e87f27-e4b task-009): green_edited_tests fired on
// docs/CAPABILITIES.md and a deliverable fixture — files the lane runner had
// registered as "test files" from the preflight outputs — and the correct
// GREEN commit was reset away. The rule is now "GREEN modified a file the
// RED commit wrote", and a discarded GREEN is pinned to a branch first.
describe('green_edited_tests is scoped to RED-committed files and never discards a GREEN unpinned', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  it('registers preflight outputs through preflightTestPaths, not blindly', () => {
    expect(src).toMatch(/preflightTestPaths\(preflightData\.outputs, testFiles\)/)
    expect(src).not.toMatch(/if \(output\.path && !testFiles\.includes\(output\.path\)\) \{\s*testFiles\.push/)
  })
  it('asks the post-GREEN batch for the RED commit files and scopes ownTestsOnly to them', () => {
    expect(src).toMatch(/postGreenSteps\(\{ wt, redSha: red\.commit_sha[^}]*\}\)/)
    expect(src).toMatch(/redCommittedFilesFromSteps\(/)
    expect(src).toMatch(/const ownTestsOnly = [\s\S]{0,600}redCommitted/)
  })
  it('pins the discarded GREEN to <laneBranch>--discarded-green before the reset', () => {
    expect(src).toMatch(/const discardedRef = `\$\{cfg\.epicBranch\}--\$\{taskId\}--discarded-green`/)
    expect(src).toMatch(/\[\.\.\.preserveHeadRefSteps\(wt, discardedRef\), \.\.\.worktreeResetToSteps\(wt, red\.commit_sha\)\]/)
    expect(src).toMatch(/green_discarded_ref/)
  })
})

// elonchesd wf_a979f3d8-f0c task-013: any `throw new Error` in a test file
// read as a placeholder. The TS/JS placeholder is the skeleton's literal.
describe('the TS/JS placeholder pattern is the skeleton literal, not the bare throw token', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  it('names the skeleton throw and the forced failure only', () => {
    // The literal statement (parse-aware under ast-grep, so a copy inside a
    // string is not a hit); the whole-body shapes never matched the real
    // skeleton, whose `// Assert` comment is a node the exact shape excludes.
    expect(src).toContain("{ pattern: \"throw new Error('RED agent: implement this assertion')\", name: 'skeleton placeholder', grep: SKELETON_THROW_RE }")
    expect(src).not.toMatch(/pattern: 'it\(\$_, \(\) => \{ throw new Error\(\$_\) \}\)'/)
    expect(src).toContain("const SKELETON_THROW_RE = 'throw new Error\\\\(.RED agent: implement this assertion.\\\\)'")
    expect(src).not.toMatch(/pattern: 'throw new Error', name: 'throw placeholder'/)
  })
})

// caliper eedom wf_fa38ac24-890 task-005: repro files a prior stage left
// untracked were collected by REFACTOR's test run. The lane removes strays
// before REFACTOR and names them.
describe('strays are cleaned and named before REFACTOR', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
  it('runs strayCleanSteps before runRefactor and logs stray_untracked_files', () => {
    const cleanAt = src.indexOf('strayCleanSteps(wt)')
    // The main path's REFACTOR dispatch (the resume path at intake starts
    // from a fresh worktree and has no prior stage to leave strays).
    const refactorAt = src.indexOf('const refResult = await runRefactor(taskId')
    expect(cleanAt).toBeGreaterThan(-1)
    expect(cleanAt).toBeLessThan(refactorAt)
    expect(src).toMatch(/stray_untracked_files/)
    expect(src).toMatch(/stray_clean_unchecked/)
  })
})

// caliper eedom wf_fa38ac24-890: REFACTOR answered {status:"blocked",
// needs_write:[]} because the mandated test run failed for a reason outside
// its scope (strays). It committed nothing, so the lane's tree is GREEN's;
// that is an honest "no refactor applied", not a lane failure. The tree is
// reset and independently verified; green completes the lane by name.
describe('a blocked REFACTOR that committed nothing is "refactor skipped", verified independently', () => {
  function responder(verifyExit: number): Responder {
    const base = happyPathResponder({ pytest: true })
    return (label, prompt) => {
      if (label.startsWith('refactor-check:')) return { should_refactor: true, reason: 'long function' }
      if (label.startsWith('refactor:')) return { status: 'blocked', needs_write: [], success: false, tests_pass: false, committed: false, failure_reason: 'test command failed on untouched tree' }
      if (label.startsWith('refactor-reset:')) return batch({ status: '' })
      if (label.startsWith('post-refactor-verify:')) return batch({ 'test-verify': `TEST_EXIT=${verifyExit}\n` })
      return base(label, prompt)
    }
  }
  it('green after the reset: lane completed at REFACTOR, refactor_skipped named in the log', async () => {
    const logs: string[] = []
    const { result } = await runLane({ respond: responder(0), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: true, logs })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    expect(logs.some((l) => /refactor_skipped: test command failed on untouched tree/.test(l))).toBe(true)
  })
  it('red after the reset: the lane fails as refactor_verify_failed, not refactor_failed', async () => {
    const { result } = await runLane({ respond: responder(1), agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: true })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.error).toMatch(/^refactor_verify_failed/)
  })
})

// elonchesd datum/player-guidance wf_dee84cc2-e64 task-001: the post-GREEN
// verify batch returned nothing twice; the lane must name the missing
// verdict, never green_verify_failed (which claims the suite was red).
describe('a post-GREEN verify batch that returns nothing is green_verify_unavailable, not a red suite', () => {
  it('fails the lane at GREEN by that name after runBatch\'s own retry', async () => {
    const base = happyPathResponder({ pytest: true })
    const labels: string[] = []
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('post-green-verify:')) { labels.push(label); return null }
      return base(label, prompt)
    }
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: true })
    expect(result.results.T1.status).toBe('failed')
    expect(result.results.T1.stage).toBe('GREEN')
    expect(result.results.T1.error).toMatch(/^green_verify_unavailable: /)
    expect(result.results.T1.error).not.toMatch(/green_verify_failed/)
    expect(labels).toEqual(['post-green-verify:T1', 'post-green-verify:T1:retry'])
  })
})

// #440, second occurrence (elonchesd player-guidance task-011 after epic-2
// task-006): GREEN reported blocked with needs_write naming the lane's OWN
// test file — the RED fixture's precondition was wrong, GREEN's diagnosis was
// exact, and it was rightly forbidden to edit the test. Bounded repair: RED
// runs once more carrying GREEN's diagnosis, the post-RED gates re-run, then
// GREEN once more. A second block by the same shape fails as before.
describe('a GREEN blocked on the lane\'s own test file re-dispatches RED once with the diagnosis (#440)', () => {
  function responder(secondGreenBlocked: boolean): { respond: Responder; labels: string[] } {
    const base = happyPathResponder({ pytest: false })
    const labels: string[] = []
    let greens = 0
    const respond: Responder = (label, prompt) => {
      labels.push(label)
      if (label.startsWith('green:') || label.startsWith('green-red-repair:')) {
        greens += 1
        if (greens === 1 || secondGreenBlocked) {
          return { ...witness, success: false, tests_pass: false, committed: false, status: 'blocked', needs_write: ['src/a.test.ts'], reason: 'AC3 case 2 fixture puts two Kings on the board; the disabled state is structural and tech-panel AC5 pins it', files_written: ['src/a.ts'] }
        }
        return { ...witness, success: true, tests_pass: true, committed: true, commit_sha: 'ccc333', files_written: ['src/a.ts'], test_exit_code: 0 }
      }
      if (label.startsWith('red-repair:')) return { ...witness, success: true, tests_pass: false, committed: true, commit_sha: 'aaa222', files_written: ['src/a.test.ts'], test_exit_code: 1, test_errors: ['AssertionError'] }
      if (label.startsWith('post-red-repair:')) return batch({ 'count-gate': '{"new_test_count":2,"required":2,"passed":true}', 'assert-check': '', ownership: 'src/a.test.ts\n', 'test-count-pattern': 'it\\(', 'test-count-after': '2\n', 'test-count-before': '0\n' })
      return base(label, prompt)
    }
    return { respond, labels }
  }

  it('RED repair carries the diagnosis, its gates re-run, and the lane completes on the second GREEN', async () => {
    const { respond, labels } = responder(false)
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status, result.results.T1.error).toBe('completed')
    const repair = calls.find((c) => c.label.startsWith('red-repair:'))!
    expect(repair.prompt).toContain('AC3 case 2 fixture puts two Kings')
    expect(repair.prompt).toContain('src/a.test.ts')
    const order = labels.map((l) => l.split(':')[0])
    expect(order.indexOf('red-repair')).toBeGreaterThan(order.indexOf('green'))
    expect(order.indexOf('post-red-repair')).toBeGreaterThan(order.indexOf('red-repair'))
    expect(order.indexOf('green-red-repair')).toBeGreaterThan(order.indexOf('post-red-repair'))
    // #341 task-012 (wf_59334c2b-c11): the post-GREEN ownership diff must
    // start at the REPAIR commit, or the repair's own test edits read as
    // GREEN touching forbidden files (file_ownership_violation on the four
    // tests the repair had just amended).
    const postGreen = calls.find((c) => c.label.startsWith('post-green:'))!
    expect(postGreen.prompt).toContain('diff --name-only aaa222 HEAD')
    expect(postGreen.prompt).not.toContain('aaa111 HEAD')
  })

  it('a second block of the same shape after the repair fails as green_blocked_needs_write', async () => {
    const { respond } = responder(true)
    const { result } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('blocked')
    expect(result.results.T1.error).toMatch(/^green_blocked_needs_write: \[src\/a\.test\.ts\]/)
    expect(result.results.T1.error).toMatch(/after one RED repair/)
  })

  it('a block naming a file outside the lane\'s own tests is not repaired (unchanged behaviour)', async () => {
    const base = happyPathResponder({ pytest: false })
    const respond: Responder = (label, prompt) => {
      if (label.startsWith('green:')) return { ...witness, success: false, tests_pass: false, committed: false, status: 'blocked', needs_write: ['tests/other.test.ts'], reason: 'foreign', files_written: [] }
      return base(label, prompt)
    }
    const { result, calls } = await runLane({ respond, agentTypes: { agentTypes: true, hooksInstalled: true }, pytest: false })
    expect(result.results.T1.status).toBe('blocked')
    expect(calls.some((c) => c.label.startsWith('red-repair:'))).toBe(false)
  })
})
