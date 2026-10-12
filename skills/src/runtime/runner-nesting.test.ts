// Tests for DAT-15 — nested workflow() resolution. A parent bundle calls
// workflow({ name | scriptPath }, args); the child runs inside the same
// runner, sharing executor, shell, per-model semaphores and the metrics sink.
// Parent and child bundles are small post-processed strings written to temp
// skills dirs; FakeExecutor timestamps make overlap observable.

import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from './runner'
import { FakeExecutor } from './fake-executor'
import { readRuntimeConfig, setModelTiers } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'dat15-nesting-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
afterEach(() => {
  setModelTiers({})
  vi.restoreAllMocks()
})

let n = 0
let dirA = ''
let dirB = ''
let repoRoot = ''
beforeEach(() => {
  const id = n++
  dirA = join(tmp, `skills-a-${id}`)
  dirB = join(tmp, `skills-b-${id}`)
  repoRoot = join(tmp, `repo-${id}`)
  for (const d of [dirA, dirB, repoRoot]) mkdirSync(d, { recursive: true })
})

function writeBundle(dir: string, file: string, body: string): string {
  const p = join(dir, file)
  writeFileSync(p, `export const meta = { name: '${file}' }\n${body}\n`)
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

function setup(concurrency: Record<string, number> = {}) {
  const executor = new FakeExecutor([], { text: '{}' })
  const shell = vi.fn(async () => ({ exit_code: 0, stdout: '', stderr: '' }))
  const run = (bundlePath: string, args: unknown = { runId: 'nest-run' }, skillsDirs = [dirA, dirB]) =>
    runBundle({
      bundlePath,
      args,
      executor,
      shell,
      skillsDirs,
      log: vi.fn(),
      runtime: runtimeWith(concurrency),
      repoRoot,
    })
  return { executor, shell, run }
}

async function waitFor(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return
    await new Promise<void>((r) => setTimeout(r, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const tick = (ms = 10) => new Promise<void>((r) => setTimeout(r, ms))

describe('nested workflow() resolution', () => {
  it('AC1: workflow({ name: "child" }) with skillsDirs [dirA, dirB] runs dirA/child.js, not dirB/child.js', async () => {
    writeBundle(dirA, 'child.js', `return 'from-A'`)
    writeBundle(dirB, 'child.js', `return 'from-B'`)
    const parent = writeBundle(tmp, `parent-${n}.js`, `return await workflow({ name: 'child' }, {})`)
    const { run } = setup()
    expect(await run(parent)).toBe('from-A')
  })

  it('AC1: a name found only in the second dir resolves there', async () => {
    writeBundle(dirB, 'only-b.js', `return 'only-in-B'`)
    const parent = writeBundle(tmp, `parent-${n}.js`, `return await workflow({ name: 'only-b' }, {})`)
    const { run } = setup()
    expect(await run(parent)).toBe('only-in-B')
  })

  it('AC2: workflow({ name: "missing" }) rejects with Error "workflow_not_found: missing" naming both dirs', async () => {
    const parent = writeBundle(tmp, `parent-${n}.js`, `return await workflow({ name: 'missing' }, {})`)
    const { run } = setup()
    const err = await run(parent).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message.startsWith('workflow_not_found: missing')).toBe(true)
    expect(message).toContain(dirA)
    expect(message).toContain(dirB)
  })

  it('AC2: the parent can catch the workflow_not_found rejection and keep running', async () => {
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `try { await workflow({ name: 'missing' }, {}) } catch (e) { return { caught: e.message.split(/[ \\n,(]/)[0] } }
       return 'not-reached'`,
    )
    const { run } = setup()
    expect(await run(parent)).toEqual({ caught: 'workflow_not_found:' })
  })

  it('AC3: workflow({ scriptPath: p }) loads p even though skillsDirs holds a same-named file', async () => {
    const elsewhere = join(tmp, `elsewhere-${n}`)
    mkdirSync(elsewhere, { recursive: true })
    writeBundle(dirA, 'child.js', `return 'from-A'`)
    const target = writeBundle(elsewhere, 'child.js', `return 'from-path'`)
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `return await workflow({ scriptPath: ${JSON.stringify(target)} }, {})`,
    )
    const { run } = setup()
    expect(await run(parent)).toBe('from-path')
  })

  it('AC3: workflow({ scriptPath: p }) works with an empty skillsDirs list', async () => {
    const target = writeBundle(tmp, `lone-${n}.js`, `return 'lone-child'`)
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `return await workflow({ scriptPath: ${JSON.stringify(target)} }, {})`,
    )
    const { run } = setup()
    expect(await run(parent, { runId: 'nest-run' }, [])).toBe('lone-child')
  })
})

describe('nested workflow() args and result', () => {
  it('AC4: the child receives the args passed to workflow() as its args global and its return value resolves the parent await', async () => {
    writeBundle(dirA, 'child.js', `return { received: args, sum: args.a + args.b }`)
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `const out = await workflow({ name: 'child' }, { a: 2, b: 5, tag: 'x' })
       return { wrapped: out }`,
    )
    const { run } = setup()
    expect(await run(parent)).toEqual({
      wrapped: { received: { a: 2, b: 5, tag: 'x' }, sum: 7 },
    })
  })

  it('AC4: the child args are the ones passed to workflow(), not the parent args', async () => {
    writeBundle(dirA, 'child.js', `return args`)
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `return { parentArgs: args, childArgs: await workflow({ name: 'child' }, { only: 'child' }) }`,
    )
    const { run } = setup()
    expect(await run(parent, { runId: 'nest-run', parent: true })).toEqual({
      parentArgs: { runId: 'nest-run', parent: true },
      childArgs: { only: 'child' },
    })
  })

  it('AC4: a child that throws rejects the parent await with the child error message', async () => {
    writeBundle(dirA, 'child.js', `throw new Error('child-boom')`)
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `try { await workflow({ name: 'child' }, {}) } catch (e) { return e.message }
       return 'not-reached'`,
    )
    const { run } = setup()
    expect(await run(parent)).toBe('child-boom')
  })

  it('AC4: the child shares the parent shell function', async () => {
    writeBundle(
      dirA,
      'child.js',
      `const r = await shell('echo hi', { cwd: '/x', timeoutMs: 1000 })
       return r.exit_code`,
    )
    const parent = writeBundle(tmp, `parent-${n}.js`, `return await workflow({ name: 'child' }, {})`)
    const { shell, run } = setup()
    expect(await run(parent)).toBe(0)
    expect(shell).toHaveBeenCalledTimes(1)
    expect(shell).toHaveBeenCalledWith('echo hi', { cwd: '/x', timeoutMs: 1000 })
  })
})

describe('nested workflow() shared semaphores and metrics', () => {
  it('AC5: with concurrency { m1: 1 } a held parent request blocks the child request on m1 until it is released', async () => {
    writeBundle(dirA, 'child.js', `return await agent('kid', { label: 'kid-0', model: 'm1' })`)
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `const outs = await parallel([
         () => agent('par', { label: 'par-0', model: 'm1' }),
         () => workflow({ name: 'child' }, {}),
       ])
       return outs.length`,
    )
    const { executor, run } = setup({ m1: 1 })
    executor.hold('par-')
    const done = run(parent)
    await waitFor(() => executor.requests.length >= 1, 'parent request to start')
    await tick(40)
    expect(executor.requests.map((r) => r.opts.label)).toEqual(['par-0'])

    executor.release('par-')
    expect(await done).toBe(2)
    expect(executor.requests.map((r) => r.opts.label).sort()).toEqual(['kid-0', 'par-0'])
  })

  it('AC5: parent and child requests on m1 never overlap in FakeExecutor timestamps', async () => {
    writeBundle(
      dirA,
      'child.js',
      `const outs = await parallel([0, 1, 2].map((i) => () => agent('k' + i, { label: 'kid-' + i, model: 'm1' })))
       return outs.length`,
    )
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `const outs = await parallel([
         () => agent('p0', { label: 'par-0', model: 'm1' }),
         () => agent('p1', { label: 'par-1', model: 'm1' }),
         () => workflow({ name: 'child' }, {}),
       ])
       return outs.length`,
    )
    const { executor, run } = setup({ m1: 1 })
    expect(await run(parent)).toBe(3)
    const spans = executor.requests.map((r) => ({ label: r.opts.label, start: r.startedAt, end: r.endedAt }))
    expect(spans).toHaveLength(5)
    expect(spans.some((s) => s.label?.startsWith('kid-'))).toBe(true)
    expect(spans.some((s) => s.label?.startsWith('par-'))).toBe(true)
    const sorted = [...spans].sort((a, b) => a.start - b.start)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].end).not.toBeNull()
      expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end as number)
    }
  })

  it('AC5: child requests are appended to the same metrics.jsonl as the parent requests', async () => {
    writeBundle(dirA, 'child.js', `return await agent('kid', { label: 'kid-0', model: 'm1' })`)
    const parent = writeBundle(
      tmp,
      `parent-${n}.js`,
      `await agent('par', { label: 'par-0', model: 'm1' })
       await workflow({ name: 'child' }, {})
       await agent('par2', { label: 'par-1', model: 'm1' })
       return 'done'`,
    )
    const { run } = setup({ m1: 1 })
    expect(await run(parent, { runId: 'nest-run' })).toBe('done')

    const runsDir = join(repoRoot, '.datum', 'runs')
    expect(readdirSync(runsDir)).toEqual(['nest-run'])
    const lines = readFileSync(join(runsDir, 'nest-run', 'metrics.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { label: string; run_id: string; model: string; outcome: string })
    expect(lines.map((l) => l.label)).toEqual(['par-0', 'kid-0', 'par-1'])
    expect(lines.every((l) => l.run_id === 'nest-run' && l.model === 'm1' && l.outcome === 'ok')).toBe(true)
  })
})
