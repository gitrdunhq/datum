// Tests for DAT-13 — runBundle appends one metrics line per executed request
// to <repoRoot>/.datum/runs/<runId>/metrics.jsonl. Bundles are small strings
// written to a temp dir; the executor is a FakeExecutor (or a throwing stub).

import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from './runner'
import { deriveRunId } from './metrics'
import { FakeExecutor } from './fake-executor'
import type { StageExecutor, StageReply } from './executor'
import { readRuntimeConfig, setModelTiers } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'dat13-metrics-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  vi.useRealTimers()
  setModelTiers({})
  vi.restoreAllMocks()
})

const KEYS = [
  'ts',
  'run_id',
  'label',
  'agent_type',
  'model',
  'prompt_tokens',
  'completion_tokens',
  'cached_tokens',
  'prefill_ms',
  'decode_ms',
  'queue_wait_ms',
  'wall_ms',
  'attempt',
  'outcome',
]

let n = 0
function freshRoot(): string {
  const root = join(tmp, `root-${n++}`)
  mkdirSync(root, { recursive: true })
  return root
}

function bundle(body: string): string {
  const p = join(tmp, `bundle-${n++}.js`)
  writeFileSync(p, `export const meta = { name: 'dat13-test' }\n${body}\n`)
  return p
}

function runtimeWith(concurrency: Record<string, number>) {
  return readRuntimeConfig({
    runtime: {
      kind: 'fake',
      models: { fast: 'fast-id', balanced: 'bal-id', deep: 'deep-id' },
      concurrency,
    },
  })
}

function run(opts: {
  root: string
  body: string
  executor: StageExecutor
  args?: unknown
  concurrency?: Record<string, number>
}): Promise<unknown> {
  return runBundle({
    bundlePath: bundle(opts.body),
    args: opts.args ?? {},
    executor: opts.executor,
    shell: vi.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' })),
    skillsDirs: [],
    log: vi.fn(),
    runtime: runtimeWith(opts.concurrency ?? {}),
    repoRoot: opts.root,
  })
}

function readLines(root: string, runId: string): Record<string, unknown>[] {
  const p = join(root, '.datum', 'runs', runId, 'metrics.jsonl')
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('deriveRunId', () => {
  it('AC3: formats the UTC start time as YYYYMMDD-HHMMSS', () => {
    expect(deriveRunId(new Date(Date.UTC(2026, 9, 12, 5, 7, 9)))).toBe('20261012-050709')
  })

  it('AC3: zero-pads every field and uses UTC not local time', () => {
    expect(deriveRunId(new Date(Date.UTC(2027, 0, 2, 3, 4, 5)))).toBe('20270102-030405')
    expect(deriveRunId(new Date(Date.UTC(2026, 11, 31, 23, 59, 59)))).toBe('20261231-235959')
  })
})

describe('runBundle metrics sink', () => {
  let root: string
  beforeEach(() => {
    root = freshRoot()
  })

  it('AC1: each executed request appends exactly one line with the exact key list in order', async () => {
    const executor = new FakeExecutor([], {
      text: '{"ok":true}',
      usage: { prompt_tokens: 11, completion_tokens: 7, cached_tokens: 5 },
    })
    await run({
      root,
      executor,
      args: { runId: 'run-keys' },
      body: `
        await agent('first prompt', { label: 'k-1', model: 'm1', agentType: 'datum-green' })
        await agent('second prompt', { label: 'k-2', model: 'm1', agentType: 'datum-green' })
        return 'done'
      `,
    })
    const lines = readLines(root, 'run-keys')
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(Object.keys(line)).toEqual(KEYS)
    expect(lines[0].label).toBe('k-1')
    expect(lines[1].label).toBe('k-2')
    expect(lines[0].run_id).toBe('run-keys')
    expect(lines[0].agent_type).toBe('datum-green')
    expect(lines[0].model).toBe('m1')
    expect(lines[0].prompt_tokens).toBe(11)
    expect(lines[0].completion_tokens).toBe(7)
    expect(lines[0].cached_tokens).toBe(5)
    expect(typeof lines[0].ts).toBe('string')
    expect(Number.isNaN(Date.parse(lines[0].ts as string))).toBe(false)
  })

  it('AC1: a tier name is recorded as its resolved model id', async () => {
    await run({
      root,
      executor: new FakeExecutor([], { text: '{}' }),
      args: { runId: 'run-tier' },
      body: `return await agent('p', { label: 't-1', model: 'balanced' })`,
    })
    const [line] = readLines(root, 'run-tier')
    expect(line.model).toBe('bal-id')
  })

  it('AC2: a reply with no usage and no timings writes 0 for the five numeric fields', async () => {
    await run({
      root,
      executor: new FakeExecutor([], { text: '{}' }),
      args: { runId: 'run-zero' },
      body: `return await agent('p', { label: 'z-1', model: 'm1' })`,
    })
    const [line] = readLines(root, 'run-zero')
    expect(line.prompt_tokens).toBe(0)
    expect(line.completion_tokens).toBe(0)
    expect(line.cached_tokens).toBe(0)
    expect(line.prefill_ms).toBe(0)
    expect(line.decode_ms).toBe(0)
  })

  it('AC3: args.runId names the run directory, which is created when absent', async () => {
    expect(existsSync(join(root, '.datum'))).toBe(false)
    await run({
      root,
      executor: new FakeExecutor([], { text: '{}' }),
      args: { runId: 'my-run-7' },
      body: `return await agent('p', { label: 'r-1', model: 'm1' })`,
    })
    expect(existsSync(join(root, '.datum', 'runs', 'my-run-7', 'metrics.jsonl'))).toBe(true)
    expect(readLines(root, 'my-run-7')[0].run_id).toBe('my-run-7')
  })

  it('AC3: a missing runId falls back to the runner start time in UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 5, 7, 9)))
    await run({
      root,
      executor: new FakeExecutor([], { text: '{}' }),
      args: {},
      body: `return await agent('p', { label: 'd-1', model: 'm1' })`,
    })
    expect(readdirSync(join(root, '.datum', 'runs'))).toEqual(['20261012-050709'])
    expect(readLines(root, '20261012-050709')[0].run_id).toBe('20261012-050709')
  })

  it('AC3: an empty-string runId is treated as missing and the derived id is used', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 5, 7, 9)))
    await run({
      root,
      executor: new FakeExecutor([], { text: '{}' }),
      args: { runId: '' },
      body: `return await agent('p', { label: 'e-1', model: 'm1' })`,
    })
    expect(readdirSync(join(root, '.datum', 'runs'))).toEqual(['20261012-050709'])
  })

  it('AC4: a request queued behind another on concurrency 1 shows queue_wait_ms > 0 and wall_ms excludes the wait', async () => {
    const executor = new FakeExecutor([], { text: '{}' })
    executor.hold('q-0')
    const done = run({
      root,
      executor,
      args: { runId: 'run-queue' },
      concurrency: { m1: 1 },
      body: `
        const outs = await parallel([
          () => agent('a', { label: 'q-0', model: 'm1' }),
          () => agent('b', { label: 'q-1', model: 'm1' }),
        ])
        return outs.length
      `,
    })
    await tick(80)
    executor.release('q-0')
    await done
    const lines = readLines(root, 'run-queue')
    expect(lines).toHaveLength(2)
    const first = lines.find((l) => l.label === 'q-0')!
    const second = lines.find((l) => l.label === 'q-1')!
    expect(first.queue_wait_ms as number).toBeLessThan(40)
    expect(first.wall_ms as number).toBeGreaterThanOrEqual(60)
    expect(second.queue_wait_ms as number).toBeGreaterThanOrEqual(60)
    expect(second.wall_ms as number).toBeLessThan(second.queue_wait_ms as number)
  })

  it('AC5: an executor that throws Error("down") writes an error line and agent() rejects with "down"', async () => {
    const executor: StageExecutor = {
      execute: async () => {
        throw new Error('down')
      },
    }
    await expect(
      run({
        root,
        executor,
        args: { runId: 'run-err' },
        body: `return await agent('p', { label: 'x-1', model: 'm1' })`,
      }),
    ).rejects.toThrow('down')
    const lines = readLines(root, 'run-err')
    expect(lines).toHaveLength(1)
    expect(lines[0].outcome).toBe('error')
    expect(lines[0].label).toBe('x-1')
    expect(Object.keys(lines[0])).toEqual(KEYS)
    expect(lines[0].prompt_tokens).toBe(0)
  })

  it('AC6: a valid reply writes outcome "ok" with attempt 1', async () => {
    await run({
      root,
      executor: new FakeExecutor([], { text: '{"fine":1}' }),
      args: { runId: 'run-ok' },
      body: `return await agent('p', { label: 'o-1', model: 'm1' })`,
    })
    const [line] = readLines(root, 'run-ok')
    expect(line.outcome).toBe('ok')
    expect(line.attempt).toBe(1)
  })

  it('AC7: an unwritable runs directory makes the call reject with the filesystem error', async () => {
    // A regular file where the runs directory must be: fails for root too,
    // unlike a chmod-based setup.
    mkdirSync(join(root, '.datum'), { recursive: true })
    writeFileSync(join(root, '.datum', 'runs'), 'not a directory')
    await expect(
      run({
        root,
        executor: new FakeExecutor([], { text: '{}' }),
        args: { runId: 'run-blocked' },
        body: `return await agent('p', { label: 'u-1', model: 'm1' })`,
      }),
    ).rejects.toThrow(/ENOTDIR|EEXIST|ENOENT|EACCES|EPERM/)
  })

  it('AC8: no line contains the prompt text or the reply text', async () => {
    await run({
      root,
      executor: new FakeExecutor([], {
        text: '{"answer":"REPLY-CANARY-9731"}',
        usage: { prompt_tokens: 3, completion_tokens: 2, cached_tokens: 0 },
      }),
      args: { runId: 'run-private' },
      body: `return await agent('PROMPT-CANARY-4417 please do the thing', { label: 'p-1', model: 'm1' })`,
    })
    const raw = readFileSync(join(root, '.datum', 'runs', 'run-private', 'metrics.jsonl'), 'utf8')
    expect(raw.length).toBeGreaterThan(0)
    expect(raw).not.toContain('PROMPT-CANARY-4417')
    expect(raw).not.toContain('REPLY-CANARY-9731')
  })

  it('AC8: an error line does not contain the prompt text either', async () => {
    const executor: StageExecutor = {
      execute: async (): Promise<StageReply> => {
        throw new Error('down')
      },
    }
    await expect(
      run({
        root,
        executor,
        args: { runId: 'run-private-err' },
        body: `return await agent('PROMPT-CANARY-8820', { label: 'p-2', model: 'm1' })`,
      }),
    ).rejects.toThrow('down')
    const raw = readFileSync(join(root, '.datum', 'runs', 'run-private-err', 'metrics.jsonl'), 'utf8')
    expect(raw).not.toContain('PROMPT-CANARY-8820')
  })
})
