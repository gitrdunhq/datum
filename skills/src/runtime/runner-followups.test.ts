// Closeout follow-ups of run 20261012-150046 (REVIEW-REPORT.md findings left
// without a decision), each pinned here before the fix.
//   SEC-001  resolveRunId joined any string into .datum/runs/<runId>.
//   SEC-002  workflow({ name }) joined any name into <dir>/<name>.js.
//   PERF-001 / SEC-004 nodeShell buffered stdout and stderr without a cap.
//   PERF-002 shell batches bypassed every concurrency bound.
//   ARCH-004 runBundle deleted globalThis.datumRuntime instead of restoring it.

import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from './runner'
import { resolveRunId, buildMetricsLine } from './metrics'
import { createNodeShell } from './shell'
import { FakeExecutor } from './fake-executor'
import { readRuntimeConfig } from '../shared/models'
import type { ShellFn } from '../shared/agents'

const tmp = mkdtempSync(join(tmpdir(), 'runner-followups-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function bundle(body: string, dir = tmp, name = `bundle-${n++}`): string {
  const p = join(dir, `${name}.js`)
  writeFileSync(p, `export const meta = { name: '${name}' }\n${body}\n`)
  return p
}

const runtime = readRuntimeConfig({ runtime: { kind: 'fake', models: { fast: 'f', balanced: 'b', deep: 'd' } } })

function run(body: string, extra: Partial<Parameters<typeof runBundle>[0]> = {}) {
  return runBundle({
    bundlePath: bundle(body),
    args: { repoRoot: tmp },
    executor: new FakeExecutor([], { text: '{}' }),
    shell: async (script: string) => ({ exit_code: 0, stdout: script, stderr: '' }),
    skillsDirs: [tmp],
    log: () => {},
    runtime,
    repoRoot: tmp,
    ...extra,
  })
}

describe('SEC-001: a run id is one plain path segment', () => {
  const start = new Date(Date.UTC(2026, 9, 12, 15, 0, 46))

  it('keeps plain ids, including batch ids', () => {
    expect(resolveRunId({ runId: '20261012-150046' }, start)).toBe('20261012-150046')
    expect(resolveRunId({ runId: '20261012-150046-b2' }, start)).toBe('20261012-150046-b2')
    expect(resolveRunId({ runId: 'r1.retry_2' }, start)).toBe('r1.retry_2')
  })

  it('throws run_id_invalid for traversal, separators, absolute paths and leading dots', () => {
    // Catches: '../../x' making the runner create directories outside .datum/runs.
    for (const bad of ['../../x', 'a/b', '/abs', '..', '.hidden', 'a\\b', 'x'.repeat(129), 'a b']) {
      expect(() => resolveRunId({ runId: bad }, start), bad).toThrow(/^run_id_invalid: /)
    }
  })

  it('still derives an id when none is given', () => {
    expect(resolveRunId({}, start)).toBe('20261012-150046')
  })

  it('refuses a bad args.runId before any metrics line is written', async () => {
    const executor = new FakeExecutor([], { text: '{}' })
    await expect(
      run(`return await agent('p', { label: 'x' })`, { args: { runId: '../escape' }, executor }),
    ).rejects.toThrow(/^run_id_invalid: /)
    expect(executor.requests).toHaveLength(0)
    expect(existsSync(join(tmp, '.datum', 'escape'))).toBe(false)
  })
})

describe('SEC-002: workflow({ name }) takes a bare bundle name only', () => {
  it('runs a child found by a plain name', async () => {
    bundle(`return 'child-ran'`, tmp, 'child-ok')
    await expect(run(`return await workflow({ name: 'child-ok' })`)).resolves.toBe('child-ran')
  })

  it('throws workflow_name_invalid for a name with a separator or ..', async () => {
    // Catches: a name assembled from data reading a .js file outside the skills dirs.
    for (const bad of ['../child-ok', 'sub/child', '..', '']) {
      await expect(run(`return await workflow({ name: ${JSON.stringify(bad)} })`), bad).rejects.toThrow(/^workflow_name_invalid: /)
    }
  })
})

describe('ARCH-001 / CORR-002: the metrics type carries the invalid outcome', () => {
  it('builds a line with outcome invalid without a cast', () => {
    const line = buildMetricsLine({
      ts: new Date(0), runId: 'r', label: 'l', agentType: undefined, model: 'm', reply: undefined,
      queueWaitMs: 0, wallMs: 0, attempt: 1, outcome: 'invalid',
    })
    expect(line.outcome).toBe('invalid')
  })
})

describe('PERF-001 / SEC-004: nodeShell bounds what it buffers', () => {
  it('fails with shell_output_too_large and kills the script when stdout passes the cap', async () => {
    // Catches: a step printing without bound growing the runner heap for ten minutes.
    const sh = createNodeShell({ maxStdoutChars: 1000, maxStderrChars: 1000 })
    const started = Date.now()
    await expect(sh('yes x', { cwd: tmp, timeoutMs: 20_000 })).rejects.toThrow(/^shell_output_too_large: stdout passed 1000 characters/)
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('keeps only the tail of stderr, marked as truncated', async () => {
    const sh = createNodeShell({ maxStdoutChars: 1000, maxStderrChars: 100 })
    const out = await sh(`for i in $(seq 1 200); do echo "line $i" >&2; done; echo done`, { cwd: tmp, timeoutMs: 20_000 })
    expect(out.exit_code).toBe(0)
    expect(out.stdout).toBe('done\n')
    expect(out.stderr.startsWith('[stderr truncated: ')).toBe(true)
    expect(out.stderr.endsWith('line 200\n')).toBe(true)
    expect(out.stderr.length).toBeLessThan(200)
  })

  it('returns small outputs unchanged', async () => {
    const sh = createNodeShell()
    const out = await sh(`echo out; echo err >&2; exit 3`, { cwd: tmp, timeoutMs: 20_000 })
    expect(out).toEqual({ exit_code: 3, stdout: 'out\n', stderr: 'err\n' })
  })
})

describe('PERF-002: shell batches share a bound', () => {
  function counting(): { shell: ShellFn; peak: () => number } {
    let inFlight = 0
    let peak = 0
    return {
      shell: async (script: string) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 15))
        inFlight--
        return { exit_code: 0, stdout: script, stderr: '' }
      },
      peak: () => peak,
    }
  }
  const fanOut = `return await parallel([1, 2, 3, 4].map((i) => () => globalThis.shell('s' + i, { cwd: '.', timeoutMs: 1000 })))`

  it('runs one shell batch at a time by default', async () => {
    // Catches: parallel() lanes starting unlimited test suites at once.
    const c = counting()
    const out = (await run(fanOut, { shell: c.shell })) as Array<{ stdout: string }>
    expect(out.map((r) => r.stdout)).toEqual(['s1', 's2', 's3', 's4'])
    expect(c.peak()).toBe(1)
  })

  it('takes its width from concurrency.shell', async () => {
    const c = counting()
    const wide = readRuntimeConfig({ runtime: { kind: 'fake', models: { fast: 'f', balanced: 'b', deep: 'd' }, concurrency: { shell: 2 } } })
    await run(fanOut, { shell: c.shell, runtime: wide })
    expect(c.peak()).toBe(2)
  })
})

describe('ARCH-004: datumRuntime is restored like shell and args', () => {
  it('puts back an outer datumRuntime after the run, on resolve and on reject', async () => {
    // Catches: a nested or concurrent run clearing the outer run's override.
    const g = globalThis as Record<string, unknown>
    const outer = { agentTypes: 'outer' }
    g.datumRuntime = outer
    try {
      await run('return globalThis.datumRuntime.agentTypes')
      expect(g.datumRuntime).toBe(outer)
      await expect(run('throw new Error("boom")')).rejects.toThrow('boom')
      expect(g.datumRuntime).toBe(outer)
    } finally {
      delete g.datumRuntime
    }
  })

  it('removes datumRuntime when there was none before', async () => {
    await run('return 1')
    expect('datumRuntime' in globalThis).toBe(false)
  })
})
