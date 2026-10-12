// Tests for DAT-11 — runBundle core: sandbox globals, parallel, pipeline,
// phase/log/budget and agent() model resolution. Bundles are small
// post-processed strings (hoisted `export const meta`, top-level `return`)
// written to a temp dir; the executor is a FakeExecutor and the shell a vi.fn.
// Source-text greps (AC9) are asserted by behaviour here: Math.random is left
// untouched and no network call is made while a bundle runs.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from './runner'
import { FakeExecutor } from './fake-executor'
import type { StageReply } from './executor'
import { readRuntimeConfig, setModelTiers, model } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'dat11-runner-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  setModelTiers({})
  vi.restoreAllMocks()
})

let n = 0
function bundle(body: string): string {
  const p = join(tmp, `bundle-${n++}.js`)
  writeFileSync(p, `export const meta = { name: 'dat11-test' }\n${body}\n`)
  return p
}

// These tests cover runBundle and parallel() semantics, not the per-model
// gate, so each model gets room for the widest fan-out here (3). An empty
// concurrency map would now run every model one at a time (PERF-001).
const runtime = readRuntimeConfig({
  runtime: {
    kind: 'fake',
    models: { fast: 'fast-id', balanced: 'bal-id', deep: 'deep-id' },
    concurrency: { 'fast-id': 3, 'bal-id': 3, 'deep-id': 3 },
  },
})

const DEFAULT_REPLY: StageReply = { text: '{}' }

type Rec = { prompt: string; model: string; opts: { label?: string }; startedAt: number; endedAt?: number | null }

function mkShell() {
  return vi.fn(async (_script: string, _opts: { cwd: string; timeoutMs: number }) => ({
    exit_code: 0,
    stdout: '',
    stderr: '',
  }))
}

function setup(script: ConstructorParameters<typeof FakeExecutor>[0] = [], logFn = vi.fn()) {
  const executor = new FakeExecutor(script, DEFAULT_REPLY)
  const shell = mkShell()
  const run = (bundlePath: string, args: unknown = {}) =>
    runBundle({ bundlePath, args, executor, shell, skillsDirs: [], log: logFn, runtime, repoRoot: tmp })
  return { executor, shell, logFn, run, recs: () => executor.requests as unknown as Rec[] }
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return
    await new Promise<void>((r) => setTimeout(r, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('runBundle return value', () => {
  it('AC1: resolves with the top-level return value (42) of a bundle with export const meta', async () => {
    const { run } = setup()
    expect(await run(bundle('return 42'))).toBe(42)
  })

  it('AC1: resolves with a returned object, passing the given args into the bundle', async () => {
    const { run } = setup()
    const out = await run(bundle('return { got: args }'), { feature: 'x', n: 3 })
    expect(out).toEqual({ got: { feature: 'x', n: 3 } })
  })

  it('AC1: a bundle that throws makes runBundle reject with that error (negative path)', async () => {
    const { run } = setup()
    await expect(run(bundle("throw new Error('bundle-boom')"))).rejects.toThrow('bundle-boom')
  })

  it('AC1: a missing bundle file rejects instead of resolving silently (negative path)', async () => {
    const { run } = setup()
    await expect(run(join(tmp, 'does-not-exist.js'))).rejects.toThrow(/ENOENT|no such file/i)
  })

  it('INVARIANT-023: only the leading export on export const meta is stripped; a literal elsewhere is intact', async () => {
    const { run } = setup()
    const out = await run(bundle("return 'say export const meta = here'"))
    expect(out).toBe('say export const meta = here')
  })
})

describe('runBundle sandbox globals', () => {
  it('AC2: agent, parallel, pipeline, phase, log, workflow and shell are functions; args and budget are objects', async () => {
    const { run } = setup()
    const out = await run(
      bundle(`return {
        agent: typeof agent, parallel: typeof parallel, pipeline: typeof pipeline,
        phase: typeof phase, log: typeof log, workflow: typeof workflow, shell: typeof shell,
        args: typeof args, budget: typeof budget,
      }`),
    )
    expect(out).toEqual({
      agent: 'function',
      parallel: 'function',
      pipeline: 'function',
      phase: 'function',
      log: 'function',
      workflow: 'function',
      shell: 'function',
      args: 'object',
      budget: 'object',
    })
  })

  it('AC2: the shell global is the shell passed to runBundle', async () => {
    const { run, shell } = setup()
    shell.mockResolvedValueOnce({ exit_code: 0, stdout: 'from-shell', stderr: '' })
    const out = await run(bundle("return (await shell('echo hi', { cwd: '/x', timeoutMs: 5 })).stdout"))
    expect(out).toBe('from-shell')
    expect(shell).toHaveBeenCalledTimes(1)
    expect(shell).toHaveBeenCalledWith('echo hi', { cwd: '/x', timeoutMs: 5 })
  })
})

describe('parallel', () => {
  const PAR = `
    const out = await parallel([
      () => agent('p1', { label: 'h-1' }),
      async () => { await agent('p2', { label: 'h-2' }); throw new Error('boom') },
      () => agent('p3', { label: 'h-3' }),
    ])
    return out`

  it('AC3: starts all three thunks before awaiting any, returns [x, null, y] in input order', async () => {
    const { run, executor, recs } = setup([
      { labelPrefix: 'h-1', reply: { text: '{"v":1}' } },
      { labelPrefix: 'h-3', reply: { text: '{"v":3}' } },
    ])
    executor.hold('h')
    const result = run(bundle(PAR))
    await waitFor(() => recs().length === 3, '3 recorded starts')
    expect(recs().map((r) => r.opts.label).sort()).toEqual(['h-1', 'h-2', 'h-3'])
    expect(recs().filter((r) => typeof r.endedAt === 'number')).toHaveLength(0)

    executor.release('h')
    expect(await result).toEqual([{ v: 1 }, null, { v: 3 }])
  })

  it('AC3: a synchronously throwing thunk maps to null and the others still run', async () => {
    const { run } = setup([{ labelPrefix: 'ok-', reply: { text: '{"v":"fine"}' } }])
    const out = await run(
      bundle(`return await parallel([
        () => { throw new Error('sync') },
        () => agent('q', { label: 'ok-1' }),
      ])`),
    )
    expect(out).toEqual([null, { v: 'fine' }])
  })

  it('AC3: results keep input order regardless of completion order (ORDERING-001)', async () => {
    const { run, executor, recs } = setup([
      { labelPrefix: 'slow-', reply: { text: '{"v":"slow"}' } },
      { labelPrefix: 'fast-', reply: { text: '{"v":"fast"}' } },
    ])
    executor.hold('slow-')
    const result = run(
      bundle(`return await parallel([
        () => agent('a', { label: 'slow-1' }),
        () => agent('b', { label: 'fast-2' }),
      ])`),
    )
    await waitFor(() => recs().some((r) => r.opts.label === 'fast-2' && typeof r.endedAt === 'number'), 'fast to finish')
    executor.release('slow-')
    expect(await result).toEqual([{ v: 'slow' }, { v: 'fast' }])
  })

  it('AC3: an empty thunk list resolves to an empty array', async () => {
    const { run } = setup()
    expect(await run(bundle('return await parallel([])'))).toEqual([])
  })
})

describe('pipeline', () => {
  const PIPE = `
    const calls = []
    const out = await pipeline(['a', 'b', 'c'],
      async (x) => { calls.push('s1:' + x); if (x === 'b') throw new Error('bad'); return x + '1' },
      async (y) => { calls.push('s2:' + y); return y + '2' })
    return { out, calls }`

  it('AC4: runs s1 then s2 per item, each stage receiving the previous stage result; a rejecting item yields null', async () => {
    const { run } = setup()
    const res = (await run(bundle(PIPE))) as { out: unknown[]; calls: string[] }
    expect(res.out).toEqual(['a12', null, 'c12'])
    expect([...res.calls].sort()).toEqual(['s1:a', 's1:b', 's1:c', 's2:a1', 's2:c1'])
  })

  it('AC4: for each surviving item s1 runs before s2, and s2 is never called for the failed item', async () => {
    const { run } = setup()
    const res = (await run(bundle(PIPE))) as { out: unknown[]; calls: string[] }
    expect(res.calls.indexOf('s1:a')).toBeLessThan(res.calls.indexOf('s2:a1'))
    expect(res.calls.indexOf('s1:c')).toBeLessThan(res.calls.indexOf('s2:c1'))
    expect(res.calls.filter((c) => c.startsWith('s2:b'))).toEqual([])
  })

  it('AC4: a failing stage never aborts the other items (LIVENESS-003)', async () => {
    const { run } = setup()
    const out = await run(
      bundle(`return await pipeline([1, 2, 3, 4],
        async (x) => { if (x % 2 === 0) throw new Error('even'); return x * 10 })`),
    )
    expect(out).toEqual([10, null, 30, null])
  })

  it('AC4: a later-stage rejection also yields null for that item only', async () => {
    const { run } = setup()
    const out = await run(
      bundle(`return await pipeline(['a', 'b'],
        async (x) => x + '1',
        async (y) => { if (y === 'b1') throw new Error('late'); return y + '2' })`),
    )
    expect(out).toEqual(['a12', null])
  })
})

describe('phase, log and budget', () => {
  it('AC5: phase(p) calls opts.log exactly once', async () => {
    const { run, logFn } = setup()
    await run(bundle("phase('p')"))
    expect(logFn).toHaveBeenCalledTimes(1)
    expect(String(logFn.mock.calls[0][0])).toContain('p')
  })

  it('AC5: log(l) calls opts.log exactly once with the line', async () => {
    const { run, logFn } = setup()
    await run(bundle("log('l')"))
    expect(logFn).toHaveBeenCalledTimes(1)
    expect(String(logFn.mock.calls[0][0])).toContain('l')
  })

  it('AC5: the logged text carries the phase title and the log line verbatim', async () => {
    const { run, logFn } = setup()
    await run(bundle("phase('phase-title-77'); log('log-line-88')"))
    expect(logFn).toHaveBeenCalledTimes(2)
    expect(String(logFn.mock.calls[0][0])).toContain('phase-title-77')
    expect(String(logFn.mock.calls[1][0])).toContain('log-line-88')
  })

  it('AC5: budget.total is null and budget.remaining() is null; spent() starts at 0', async () => {
    const { run } = setup()
    const out = await run(bundle('return { total: budget.total, remaining: budget.remaining(), spent: budget.spent() }'))
    expect(out).toEqual({ total: null, remaining: null, spent: 0 })
  })

  it('AC5: budget.spent() equals the sum of prompt_tokens + completion_tokens over replies', async () => {
    const { run } = setup([
      { labelPrefix: 'u1', reply: { text: '{}', usage: { prompt_tokens: 10, completion_tokens: 5, cached_tokens: 3 } } },
      { labelPrefix: 'u2', reply: { text: '{}', usage: { prompt_tokens: 7, completion_tokens: 3, cached_tokens: 0 } } },
    ])
    const out = await run(
      bundle(`await agent('a', { label: 'u1' })
        const mid = budget.spent()
        await agent('b', { label: 'u2' })
        return { mid, end: budget.spent(), remaining: budget.remaining() }`),
    )
    expect(out).toEqual({ mid: 15, end: 25, remaining: null })
  })

  it('AC5: a reply without usage adds 0 to budget.spent()', async () => {
    const { run } = setup([{ labelPrefix: 'nu', reply: { text: '{}' } }])
    const out = await run(bundle("await agent('a', { label: 'nu-1' }); return budget.spent()"))
    expect(out).toBe(0)
  })
})

describe('agent()', () => {
  it('AC6: sends a StageRequest with the resolved model, the prompt unchanged and opts.label, and returns parseAgentJson(reply.text)', async () => {
    const { run, recs } = setup([
      { labelPrefix: 'x', reply: { text: 'Sure:\n```json\n{"ok":true,"n":3}\n```' } },
    ])
    const out = await run(bundle("return await agent('hello prompt', { model: 'fast-id', label: 'x' })"))
    expect(out).toEqual({ ok: true, n: 3 })
    expect(recs()).toHaveLength(1)
    expect(recs()[0].model).toBe('fast-id')
    expect(recs()[0].prompt).toBe('hello prompt')
    expect(recs()[0].opts).toMatchObject({ label: 'x' })
  })

  it('AC6: a tier name in opts.model resolves to that tier id from the runtime models map', async () => {
    const { run, recs } = setup()
    await run(
      bundle(`await agent('a', { model: 'fast', label: 't1' })
        await agent('b', { model: 'balanced', label: 't2' })
        await agent('c', { model: 'deep', label: 't3' })`),
    )
    expect(recs().map((r) => r.model)).toEqual(['fast-id', 'bal-id', 'deep-id'])
  })

  it('AC6: without opts.schema the parsed value is returned unvalidated', async () => {
    const { run } = setup([{ labelPrefix: 'ns', reply: { text: '{"anything":[1,2,3]}' } }])
    const out = await run(bundle("return await agent('q', { label: 'ns-1' })"))
    expect(out).toEqual({ anything: [1, 2, 3] })
  })

  it('AC6: each agent() call produces exactly one executor request', async () => {
    const { run, recs } = setup()
    await run(bundle("await agent('a', { label: 'c1' }); await agent('b', { label: 'c2' })"))
    expect(recs().map((r) => r.opts.label)).toEqual(['c1', 'c2'])
  })

  it('INVARIANT-020: runBundle feeds the runtime models triple to setModelTiers', async () => {
    const { run } = setup()
    setModelTiers({ fast: 'other', balanced: 'other', deep: 'other' })
    await run(bundle('return 1'))
    expect(model('fast')).toBe('fast-id')
    expect(model('balanced')).toBe('bal-id')
    expect(model('deep')).toBe('deep-id')
  })
})

describe('runner purity (AC9 by behaviour)', () => {
  it('AC9: Math.random is not patched; a bundle calling it sees the host implementation', async () => {
    const host = vi.spyOn(Math, 'random').mockReturnValue(0.123)
    const { run } = setup()
    const out = await run(bundle('return Math.random()'))
    expect(out).toBe(0.123)
    expect(Math.random).toBe(host as unknown as typeof Math.random)
  })

  it('AC9: running a bundle with agent calls makes no network call', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network is forbidden')
    })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const { run } = setup()
      await run(bundle("await agent('a', { label: 'net-1' }); await parallel([() => agent('b', { label: 'net-2' })]); return 1"))
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
