// Tests for DAT-12 — runBundle gates agent() calls per model and stamps every
// request with the X-Client / X-Priority headers. Bundles are small
// post-processed strings written to a temp dir; the executor is a counting
// wrapper around FakeExecutor so max-in-flight and headers are observable.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from './runner'
import { FakeExecutor } from './fake-executor'
import type { StageExecutor, StageReply, StageRequest } from './executor'
import { readRuntimeConfig, setModelTiers } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'dat12-runner-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  setModelTiers({})
  vi.restoreAllMocks()
})

let n = 0
function bundle(body: string): string {
  const p = join(tmp, `bundle-${n++}.js`)
  writeFileSync(p, `export const meta = { name: 'dat12-test' }\n${body}\n`)
  return p
}

const DEFAULT_REPLY: StageReply = { text: '{}' }

function runtimeWith(concurrency: Record<string, number>) {
  return readRuntimeConfig({
    runtime: {
      kind: 'fake',
      models: { fast: 'fast-id', balanced: 'bal-id', deep: 'deep-id' },
      concurrency,
    },
  })
}

// Wraps a FakeExecutor: tracks concurrent execute() calls per model and keeps
// the headers each request carried.
class CountingExecutor implements StageExecutor {
  readonly inner = new FakeExecutor([], DEFAULT_REPLY)
  readonly headers: Array<Record<string, string>> = []
  private live = new Map<string, number>()
  readonly max = new Map<string, number>()

  hold(prefix: string): void {
    this.inner.hold(prefix)
  }
  release(prefix: string): void {
    this.inner.release(prefix)
  }
  maxFor(model: string): number {
    return this.max.get(model) ?? 0
  }
  async execute(req: StageRequest): Promise<StageReply> {
    this.headers.push(req.headers)
    const now = (this.live.get(req.model) ?? 0) + 1
    this.live.set(req.model, now)
    this.max.set(req.model, Math.max(this.maxFor(req.model), now))
    try {
      return await this.inner.execute(req)
    } finally {
      this.live.set(req.model, (this.live.get(req.model) ?? 1) - 1)
    }
  }
}

function setup(concurrency: Record<string, number>) {
  const executor = new CountingExecutor()
  const shell = vi.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' }))
  const run = (bundlePath: string) =>
    runBundle({
      bundlePath,
      args: {},
      executor,
      shell,
      skillsDirs: [],
      log: vi.fn(),
      runtime: runtimeWith(concurrency),
      repoRoot: tmp,
    })
  return { executor, run }
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return
    await new Promise<void>((r) => setTimeout(r, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms))

function fanOut(count: number, model: string, labelPrefix: string): string {
  return `
    const outs = await parallel(Array.from({ length: ${count} }, (_, i) =>
      () => agent('p' + i, { label: '${labelPrefix}' + i, model: '${model}' })))
    return outs.length
  `
}

describe('runBundle per-model concurrency', () => {
  it('AC1: concurrency { m1: 2 } with 5 held parallel agent() calls starts 2, never more than 2 at once, and all 5 finish after release', async () => {
    const { executor, run } = setup({ m1: 2 })
    executor.hold('w-')
    const done = run(bundle(fanOut(5, 'm1', 'w-')))
    await waitFor(() => executor.inner.requests.length >= 2, 'two requests to start')
    await tick(30)
    expect(executor.inner.requests).toHaveLength(2)

    executor.release('w-')
    expect(await done).toBe(5)
    expect(executor.inner.requests).toHaveLength(5)
    expect(executor.inner.requests.every((r) => r.endedAt !== null)).toBe(true)
    expect(executor.maxFor('m1')).toBe(2)
  })

  it('AC2: a model with no concurrency entry runs 1 request at a time through runBundle', async () => {
    const { executor, run } = setup({ other: 4 })
    executor.hold('u-')
    const done = run(bundle(fanOut(3, 'unlisted', 'u-')))
    await waitFor(() => executor.inner.requests.length >= 1, 'first request to start')
    await tick(30)
    expect(executor.inner.requests).toHaveLength(1)

    executor.release('u-')
    expect(await done).toBe(3)
    expect(executor.maxFor('unlisted')).toBe(1)
  })

  it('AC1: a tier name is limited by the concurrency of its resolved model id', async () => {
    const { executor, run } = setup({ 'bal-id': 2 })
    executor.hold('t-')
    const body = `
      const outs = await parallel(Array.from({ length: 4 }, (_, i) =>
        () => agent('p' + i, { label: 't-' + i, model: 'balanced' })))
      return outs.length
    `
    const done = run(bundle(body))
    await waitFor(() => executor.inner.requests.length >= 2, 'two requests to start')
    await tick(30)
    expect(executor.inner.requests).toHaveLength(2)
    executor.release('t-')
    expect(await done).toBe(4)
    expect(executor.maxFor('bal-id')).toBe(2)
  })

  it('AC6: over 50 queued agent() calls the in-flight count never exceeds concurrency[model]', async () => {
    const { executor, run } = setup({ m1: 3 })
    expect(await run(bundle(fanOut(50, 'm1', 'q-')))).toBe(50)
    expect(executor.inner.requests).toHaveLength(50)
    expect(executor.maxFor('m1')).toBeLessThanOrEqual(3)
    expect(executor.maxFor('m1')).toBeGreaterThan(0)
  })

  it('AC1: a failing executor call releases its slot so queued calls still run (negative path)', async () => {
    const executor = new CountingExecutor()
    let calls = 0
    const orig = executor.execute.bind(executor)
    executor.execute = async (req) => {
      if (calls++ === 0) throw new Error('boom')
      return orig(req)
    }
    const out = await runBundle({
      bundlePath: bundle(`
        const outs = await parallel([0, 1, 2].map((i) => () => agent('p' + i, { label: 'f-' + i, model: 'm1' })))
        return outs.map((o) => (o === null ? 'null' : 'ok'))
      `),
      args: {},
      executor,
      shell: vi.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' })),
      skillsDirs: [],
      log: vi.fn(),
      runtime: runtimeWith({ m1: 1 }),
      repoRoot: tmp,
    })
    expect(out).toEqual(['null', 'ok', 'ok'])
  })
})

describe('runBundle request headers', () => {
  it("AC5: every request carries { 'X-Client': 'datum', 'X-Priority': 'batch' } under the default runtime config", async () => {
    const { executor, run } = setup({ m1: 2 })
    await run(bundle(fanOut(4, 'm1', 'h-')))
    expect(executor.headers).toHaveLength(4)
    for (const h of executor.headers) {
      expect(h).toEqual({ 'X-Client': 'datum', 'X-Priority': 'batch' })
    }
  })

  it('AC5: headers follow the configured client and priority', async () => {
    const executor = new CountingExecutor()
    await runBundle({
      bundlePath: bundle(`return await agent('p', { label: 'c-1', model: 'm1' })`),
      args: {},
      executor,
      shell: vi.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' })),
      skillsDirs: [],
      log: vi.fn(),
      runtime: readRuntimeConfig({
        runtime: {
          kind: 'fake',
          models: { fast: 'f', balanced: 'b', deep: 'd' },
          client: 'other-client',
          priority: 'interactive',
        },
      }),
      repoRoot: tmp,
    })
    expect(executor.headers).toEqual([{ 'X-Client': 'other-client', 'X-Priority': 'interactive' }])
  })
})

describe('runBundle semaphore overhead', () => {
  it('AC7: 1,000 queued agent() calls against a FakeExecutor average under 5 ms of overhead each', async () => {
    const { executor, run } = setup({ m1: 4 })
    const path = bundle(fanOut(1000, 'm1', 'o-'))
    const t0 = performance.now()
    const count = await run(path)
    const perRequest = (performance.now() - t0) / 1000
    expect(count).toBe(1000)
    expect(executor.inner.requests).toHaveLength(1000)
    expect(executor.maxFor('m1')).toBeLessThanOrEqual(4)
    expect(perRequest).toBeLessThan(5)
  })
})
