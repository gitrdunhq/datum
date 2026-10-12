// Review iteration 1 (REVIEW-REPORT.md, run wf_d4c392f0-a05): four high
// findings in the runner, each pinned here before the fix.
//   CORR-001 runBundle never exposed the shell or args as globals, so every
//            runBatch inside a real bundle fell back to the LLM transport.
//   ARCH-001 bundles keep their own copy of the tier table, so a bundle's
//            model('fast') arrives as 'haiku' (or a config.json override),
//            never as the runtime model id.
//   PERF-001 an empty concurrency map disabled the per-model gate.
//   CORR-002 tierOf returned the lowest tier sharing a model id.

import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle, resolveModel } from './runner'
import { FakeExecutor } from './fake-executor'
import type { StageExecutor, StageReply, StageRequest } from './executor'
import { STAGE_RESULT_SCHEMA } from '../shared/schemas'
import { readRuntimeConfig } from '../shared/models'

const tmp = mkdtempSync(join(tmpdir(), 'review-fixes-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function bundle(body: string): string {
  const p = join(tmp, `bundle-${n++}.js`)
  writeFileSync(p, `export const meta = { name: 'review-fixes' }\n${body}\n`)
  return p
}

const distinct = readRuntimeConfig({
  runtime: { kind: 'fake', models: { fast: 'fast-id', balanced: 'bal-id', deep: 'deep-id' } },
})

function run(body: string, executor: StageExecutor, runtime = distinct, extra: Record<string, unknown> = {}) {
  return runBundle({
    bundlePath: bundle(body),
    args: { runId: `rf-${n++}`, repoRoot: tmp },
    executor,
    shell: async (script: string) => ({ exit_code: 0, stdout: `ran:${script}`, stderr: '' }),
    skillsDirs: [],
    log: () => {},
    runtime,
    repoRoot: tmp,
    ...extra,
  })
}

describe('CORR-001: a bundle sees the runner shell and args as globals', () => {
  it('exposes globalThis.shell and globalThis.args for the run, so runBatch takes the shell path', async () => {
    // Catches: runBatch inside a real bundle resolving no shell and sending
    // every datum-cli batch to the executor, the path this epic removes.
    const executor = new FakeExecutor([], { text: '{}' })
    const out = await run(
      `const r = await globalThis.shell('echo hi', { cwd: '.', timeoutMs: 1000 }); return { stdout: r.stdout, repoRoot: globalThis.args && globalThis.args.repoRoot }`,
      executor,
    )
    expect(out).toEqual({ stdout: 'ran:echo hi', repoRoot: tmp })
    expect(executor.requests).toHaveLength(0)
  })

  it('restores the previous globals when the run settles, on resolve and on reject', async () => {
    // Catches: a leaked shell or args global steering a later run.
    const g = globalThis as Record<string, unknown>
    g.shell = 'outer-shell'
    g.args = 'outer-args'
    try {
      await run('return 1', new FakeExecutor([], { text: '{}' }))
      expect(g.shell).toBe('outer-shell')
      expect(g.args).toBe('outer-args')
      await expect(run('throw new Error("boom")', new FakeExecutor([], { text: '{}' }))).rejects.toThrow('boom')
      expect(g.shell).toBe('outer-shell')
      expect(g.args).toBe('outer-args')
    } finally {
      delete g.shell
      delete g.args
    }
  })
})

describe('ARCH-001: bundle-side tier names reach the executor as runtime model ids', () => {
  it('maps the default tier literals haiku, sonnet and opus to the runtime fast, balanced and deep ids', () => {
    // Catches: the executor receiving 'haiku' because the bundle's private
    // tier table never saw the runtime models.
    expect(resolveModel(distinct, 'haiku')).toBe('fast-id')
    expect(resolveModel(distinct, 'sonnet')).toBe('bal-id')
    expect(resolveModel(distinct, 'opus')).toBe('deep-id')
  })

  it('maps a config.json models override the bundle used to the runtime id of the same tier', () => {
    // Catches: a repo whose .datum/config.json sets models.fast to its own
    // name sending that name to the executor.
    const bundleTiers = { fast: 'my-fast', balanced: 'my-bal', deep: 'my-deep' }
    expect(resolveModel(distinct, 'my-fast', bundleTiers)).toBe('fast-id')
    expect(resolveModel(distinct, 'my-deep', bundleTiers)).toBe('deep-id')
  })

  it('leaves tier names and runtime ids as before, and an unknown literal unchanged', () => {
    // Catches: the mapping disturbing the cases that already worked.
    expect(resolveModel(distinct, 'fast')).toBe('fast-id')
    expect(resolveModel(distinct, 'deep-id')).toBe('deep-id')
    expect(resolveModel(distinct, undefined)).toBe('bal-id')
    expect(resolveModel(distinct, 'some-unknown-model')).toBe('some-unknown-model')
  })
})

describe('PERF-001: an empty concurrency map still runs each model one request at a time', () => {
  it('never has two requests for the same model in flight when concurrency is {}', async () => {
    // Catches: `gated = keys(concurrency).length > 0` skipping the semaphore,
    // so a parallel() fan-out hit one model at full width.
    let inFlight = 0
    let peak = 0
    const executor: StageExecutor = {
      async execute(_req: StageRequest): Promise<StageReply> {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 15))
        inFlight--
        return { text: '{}' }
      },
    }
    expect(distinct.concurrency).toEqual({})
    await run(
      `return await parallel([1, 2, 3].map((i) => () => agent('p' + i, { label: 'k' + i, model: 'fast' })))`,
      executor,
    )
    expect(peak).toBe(1)
  })
})

describe('CORR-002: when tiers share a model id, the current tier is the highest one', () => {
  it('retries an invalid fast reply on deep when fast and balanced share an id', async () => {
    // Catches: tierOf returning fast for the shared id, so the retry target
    // (balanced) equalled the current model and the retry was skipped.
    const sharedFastBalanced = readRuntimeConfig({
      runtime: { kind: 'fake', models: { fast: 'same-id', balanced: 'same-id', deep: 'deep-id' } },
    })
    const valid = { success: true, tests_pass: false, committed: false, read_witness: {}, files_written: ['a.test.ts'], test_exit_code: 1 }
    const replies: StageReply[] = [{ text: JSON.stringify({ success: true }) }, { text: JSON.stringify(valid) }]
    let i = 0
    const executor = new FakeExecutor([{ labelPrefix: 'stage-x', reply: () => replies[i++] }], { text: '{}' })
    const out = await run(
      `return await agent('do it', { label: 'stage-x', model: 'fast', schema: ${JSON.stringify(STAGE_RESULT_SCHEMA)} })`,
      executor,
      sharedFastBalanced,
    )
    expect(out).toEqual(valid)
    expect(executor.requests.map((r) => r.model)).toEqual(['same-id', 'deep-id'])
  })
})
