// Tests for DAT-17 — a real subprocess shell (nodeShell) and the end-to-end
// fixture bundles. The fixtures are plain .js files in post-processed bundle
// shape; they are copied into a temp skills dir and run through runBundle with
// a scripted FakeExecutor and the real nodeShell.
//
// Fixture contract (what the tests below pin):
//   fixture-go.js    receives args { script, cwd }. Calls, in this order:
//     phase(...) and log(...) (any text);
//     free    = agent(_, { label: 'free-form', model: 'fast' })            no schema
//     checked = agent(_, { label: 'checked',   model: 'fast', schema })     schema { type: 'object',
//                                                                          required: ['ok'],
//                                                                          properties: { ok: { type: 'boolean' } } }
//     sh      = shell(args.script, { cwd: args.cwd, timeoutMs: 5000 }); the stdout is a JSON array whose
//               first row carries { exit_code, stdout }, parsed inline with JSON.parse (no imports);
//     par     = parallel([ () => agent(_, { label: 'par-ok' }), () => { throw new Error(...) } ])
//     child   = workflow({ name: 'fixture-child' }, { n: 2 })
//     return { free, checked, shell: { exit_code, stdout }, parallel: par, child }
//   fixture-child.js makes one agent(_, { label: 'child-step' }) call and
//     returns { reply: <parsed reply>, got: <its args> }.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runBundle } from './runner'
import { nodeShell } from './shell'
import { FakeExecutor } from './fake-executor'
import type { ScriptEntry } from './fake-executor'
import type { StageReply } from './executor'
import { batchScript } from '../shared/batch'
import { readRuntimeConfig, setModelTiers } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'dat17-runner-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  setModelTiers({})
  vi.restoreAllMocks()
})

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

const runtime = readRuntimeConfig({
  runtime: { kind: 'fake', models: { fast: 'fast-id', balanced: 'bal-id', deep: 'deep-id' } },
})

let n = 0
const freshDir = (prefix: string): string => {
  const d = join(tmp, `${prefix}-${n++}`)
  mkdirSync(d, { recursive: true })
  return d
}

// ---------------------------------------------------------------- nodeShell

describe('nodeShell', () => {
  it('AC1: printf ok resolves { exit_code: 0, stdout: "ok", stderr: "" }', async () => {
    const out = await nodeShell('printf ok', { cwd: tmp, timeoutMs: 5000 })
    expect(out).toEqual({ exit_code: 0, stdout: 'ok', stderr: '' })
  })

  it('AC1: a non-zero exit resolves with that exit code and the captured stderr (negative path)', async () => {
    const out = await nodeShell('printf bad >&2; exit 3', { cwd: tmp, timeoutMs: 5000 })
    expect(out).toEqual({ exit_code: 3, stdout: '', stderr: 'bad' })
  })

  it('AC1: the script runs in the given cwd', async () => {
    const dir = freshDir('cwd')
    const out = await nodeShell('pwd', { cwd: dir, timeoutMs: 5000 })
    expect(out.exit_code).toBe(0)
    expect(out.stdout.trim()).toBe(realpathSync(dir))
  })

  it('AC1: a script exceeding timeoutMs rejects with a message containing "timeout", in bounded time', async () => {
    const started = performance.now()
    await expect(nodeShell('sleep 20', { cwd: tmp, timeoutMs: 300 })).rejects.toThrow(/timeout/)
    expect(performance.now() - started).toBeLessThan(5000)
  })
})

// ------------------------------------------------------------ fixture shape

describe('fixture bundles', () => {
  it.each(['fixture-go.js', 'fixture-child.js'])(
    'AC2: %s starts with `export const meta`, uses a top-level return and has no import',
    (name) => {
      const source = readFileSync(join(FIXTURES, name), 'utf8')
      expect(source.startsWith('export const meta')).toBe(true)
      expect(source).toMatch(/^return\b/m)
      expect(source).not.toMatch(/^\s*import\b/m)
      expect(source).not.toMatch(/\bimport\s*\(/)
    },
  )
})

// --------------------------------------------------- end-to-end fixture run

const FREE_REPLY: StageReply = { text: '{"answer":"free"}' }
const CHECKED_OK: StageReply = { text: '{"ok":true}' }
const CHECKED_BAD: StageReply = { text: '{"nope":1}' }
const PAR_REPLY: StageReply = { text: '{"par":1}' }
const CHILD_REPLY: StageReply = { text: '{"child":"done"}' }

const EXPECTED = {
  free: { answer: 'free' },
  checked: { ok: true },
  shell: { exit_code: 0, stdout: 'fixture-shell-ok' },
  parallel: [{ par: 1 }, null],
  child: { reply: { child: 'done' }, got: { n: 2 } },
}

// A one-step batch whose stdout is the literal fixture-shell-ok.
const SHELL_SCRIPT = batchScript([{ name: 'echo', command: 'printf fixture-shell-ok' }])

function scripted(checked: ScriptEntry['reply']): ScriptEntry[] {
  return [
    { labelPrefix: 'free-form', reply: FREE_REPLY },
    { labelPrefix: 'checked', reply: checked },
    { labelPrefix: 'par-ok', reply: PAR_REPLY },
    { labelPrefix: 'child-step', reply: CHILD_REPLY },
  ]
}

interface Metric {
  label: string
  model: string
  attempt: number
  outcome: string
}

function readMetrics(repoRoot: string, runId: string): Metric[] {
  const p = join(repoRoot, '.datum', 'runs', runId, 'metrics.jsonl')
  if (!existsSync(p)) return []
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Metric)
}

function e2e(script: ScriptEntry[], opts: { withChild?: boolean } = {}) {
  const { withChild = true } = opts
  const skillsDir = freshDir('skills')
  const repoRoot = freshDir('repo')
  const cwd = freshDir('cwd')
  const runId = `dat17-run-${n++}`
  copyFileSync(join(FIXTURES, 'fixture-go.js'), join(skillsDir, 'fixture-go.js'))
  if (withChild) copyFileSync(join(FIXTURES, 'fixture-child.js'), join(skillsDir, 'fixture-child.js'))
  const executor = new FakeExecutor(script, { text: '{}' })
  const logFn = vi.fn()
  const run = () =>
    runBundle({
      bundlePath: join(skillsDir, 'fixture-go.js'),
      args: { runId, script: SHELL_SCRIPT, cwd },
      executor,
      shell: nodeShell,
      skillsDirs: [skillsDir],
      log: logFn,
      runtime,
      repoRoot,
    })
  const metrics = (): Metric[] => readMetrics(repoRoot, runId)
  const labels = (): Array<string | undefined> => executor.requests.map((r) => r.opts.label)
  return { executor, run, metrics, labels, logFn }
}

describe('runBundle on fixture-go.js with FakeExecutor and nodeShell', () => {
  it('AC3: returns the exact parent result with the child embedded, the shell literal and null for the rejected thunk', async () => {
    const { run } = e2e(scripted(CHECKED_OK))
    expect(await run()).toEqual(EXPECTED)
  })

  it('AC3: phase and log are forwarded to the log sink', async () => {
    const { run, logFn } = e2e(scripted(CHECKED_OK))
    await run()
    const lines = logFn.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.startsWith('== ') && l.endsWith(' =='))).toBe(true)
    expect(lines.some((l) => !l.startsWith('== '))).toBe(true)
  })

  it('AC4: the executor sees the labels in call order', async () => {
    const { run, labels } = e2e(scripted(CHECKED_OK))
    await run()
    expect(labels()).toEqual(['free-form', 'checked', 'par-ok', 'child-step'])
  })

  it('AC5: metrics.jsonl has exactly one line per recorded request, all ok', async () => {
    const { run, executor, metrics } = e2e(scripted(CHECKED_OK))
    await run()
    expect(executor.requests).toHaveLength(4)
    const m = metrics()
    expect(m).toHaveLength(executor.requests.length)
    expect(m.map((l) => l.label)).toEqual(['free-form', 'checked', 'par-ok', 'child-step'])
    expect(m.map((l) => l.outcome)).toEqual(['ok', 'ok', 'ok', 'ok'])
  })
})

// ------------------------------------------------------------ negative paths

describe('runBundle negative paths (R10.4)', () => {
  it('AC6: workflow_not_found rejects when fixture-child is in no skills dir, naming the workflow', async () => {
    const { run, labels, metrics } = e2e(scripted(CHECKED_OK), { withChild: false })
    await expect(run()).rejects.toThrow(/^workflow_not_found: fixture-child/)
    // Everything before the missing child ran; nothing was requested for it.
    expect(labels()).toEqual(['free-form', 'checked', 'par-ok'])
    expect(metrics()).toHaveLength(3)
  })

  it('AC6: cli_call_bypassed_runbatch rejects an agent() typed datum-cli before any executor or metrics I/O', async () => {
    const dir = freshDir('inline')
    const repoRoot = freshDir('repo')
    const runId = `dat17-run-${n++}`
    const bundlePath = join(dir, 'cli.js')
    writeFileSync(
      bundlePath,
      `export const meta = { name: 'cli' }\nreturn await agent('p', { label: 'cli-stage', agentType: 'datum-cli' })\n`,
    )
    const executor = new FakeExecutor([], { text: '{}' })
    await expect(
      runBundle({
        bundlePath,
        args: { runId },
        executor,
        shell: nodeShell,
        skillsDirs: [],
        log: vi.fn(),
        runtime,
        repoRoot,
      }),
    ).rejects.toThrow(/^cli_call_bypassed_runbatch.*cli-stage/)
    expect(executor.requests).toHaveLength(0)
    expect(existsSync(join(repoRoot, '.datum', 'runs', runId, 'metrics.jsonl'))).toBe(false)
  })

  it('AC6: a schema-invalid fast reply followed by a valid one tiers up to balanced and the run still matches', async () => {
    const replies = [CHECKED_BAD, CHECKED_OK]
    let i = 0
    const { run, executor, labels, metrics } = e2e(scripted(() => replies[i++]))
    expect(await run()).toEqual(EXPECTED)
    expect(labels()).toEqual(['free-form', 'checked', 'checked', 'par-ok', 'child-step'])
    const checked = executor.requests.filter((r) => r.opts.label === 'checked')
    expect(checked.map((r) => r.model)).toEqual(['fast-id', 'bal-id'])
    const m = metrics()
    expect(m).toHaveLength(executor.requests.length)
    expect(m.filter((l) => l.label === 'checked').map((l) => [l.model, l.attempt, l.outcome])).toEqual([
      ['fast-id', 1, 'invalid'],
      ['bal-id', 2, 'ok'],
    ])
  })

  it('AC6: a schema-invalid reply failing twice yields null in its slot and two invalid metrics lines', async () => {
    const { run, executor, metrics } = e2e(scripted(CHECKED_BAD))
    expect(await run()).toEqual({ ...EXPECTED, checked: null })
    expect(executor.requests.filter((r) => r.opts.label === 'checked')).toHaveLength(2)
    const m = metrics()
    expect(m).toHaveLength(executor.requests.length)
    expect(m.filter((l) => l.label === 'checked').map((l) => [l.attempt, l.outcome])).toEqual([
      [1, 'invalid'],
      [2, 'invalid'],
    ])
  })

  it('AC6: a deep-tier schema miss makes one request, returns null and writes one invalid line', async () => {
    const dir = freshDir('inline')
    const repoRoot = freshDir('repo')
    const runId = `dat17-run-${n++}`
    const bundlePath = join(dir, 'deep.js')
    const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } }
    writeFileSync(
      bundlePath,
      `export const meta = { name: 'deep' }\nreturn await agent('p', { label: 'deep-stage', model: 'deep', schema: ${JSON.stringify(schema)} })\n`,
    )
    const executor = new FakeExecutor([{ labelPrefix: 'deep-stage', reply: CHECKED_BAD }], { text: '{}' })
    const out = await runBundle({
      bundlePath,
      args: { runId },
      executor,
      shell: nodeShell,
      skillsDirs: [],
      log: vi.fn(),
      runtime,
      repoRoot,
    })
    expect(out).toBeNull()
    expect(executor.requests).toHaveLength(1)
    expect(executor.requests[0].model).toBe('deep-id')
    const lines = readMetrics(repoRoot, runId)
    expect(lines.map((l) => [l.label, l.attempt, l.outcome])).toEqual([['deep-stage', 1, 'invalid']])
  })
})
