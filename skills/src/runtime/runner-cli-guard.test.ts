// Tests for DAT-16 — runBundle rejects agent() calls typed 'datum-cli' (those
// belong to runBatch, not to a model call) and forces agent types on for the
// bundle through a globalThis.datumRuntime override. The bundled copy of
// agent-types.ts reads globals, not the runner's module instance, so the
// override is a plain global flag that readAgentTypeConfig honours.

import { describe, it, expect, afterAll, afterEach, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runBundle } from './runner'
import { FakeExecutor } from './fake-executor'
import type { StageReply } from './executor'
import { readRuntimeConfig, setModelTiers } from '../shared/models'
import {
  configureAgentTypes,
  readAgentTypeConfig,
  resetAgentTypesForTests,
  stageOpts,
} from '../shared/agent-types'

const tmp = mkdtempSync(join(tmpdir(), 'dat16-cli-guard-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const g = globalThis as Record<string, unknown>

beforeEach(() => {
  delete g.datumRuntime
  resetAgentTypesForTests()
})
afterEach(() => {
  delete g.datumRuntime
  resetAgentTypesForTests()
  setModelTiers({})
})

let n = 0
function bundle(body: string): string {
  const p = join(tmp, `bundle-${n++}.js`)
  writeFileSync(p, `export const meta = { name: 'dat16-test' }\n${body}\n`)
  return p
}

const runtime = readRuntimeConfig({
  runtime: { kind: 'fake', models: { fast: 'fast-id', balanced: 'bal-id', deep: 'deep-id' } },
})
const DEFAULT_REPLY: StageReply = { text: '{}' }

// Each run gets its own repoRoot so a metrics line (or the run dir) would be
// visible as a file under it.
function setup() {
  const repoRoot = mkdtempSync(join(tmp, 'repo-'))
  const executor = new FakeExecutor([], DEFAULT_REPLY)
  const shell = async () => ({ exit_code: 0, stdout: '', stderr: '' })
  const run = (bundlePath: string, args: unknown = {}) =>
    runBundle({ bundlePath, args, executor, shell, skillsDirs: [], log: () => {}, runtime, repoRoot })
  return { executor, repoRoot, run }
}

function metricsFiles(repoRoot: string): string[] {
  const runs = join(repoRoot, '.datum', 'runs')
  if (!existsSync(runs)) return []
  return readdirSync(runs).filter((d) => existsSync(join(runs, d, 'metrics.jsonl')))
}

describe('runBundle datum-cli guard', () => {
  it("AC1: agent('p', { agentType: 'datum-cli', label: 'leak' }) rejects with cli_call_bypassed_runbatch naming the label", async () => {
    const { run } = setup()
    const err = await run(bundle("return await agent('p', { agentType: 'datum-cli', label: 'leak' })")).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message.startsWith('cli_call_bypassed_runbatch')).toBe(true)
    expect(message).toContain('leak')
  })

  it('AC1: the rejection names the label of each offending call, not a fixed string', async () => {
    const { run } = setup()
    const err = await run(bundle("return await agent('p', { agentType: 'datum-cli', label: 'other-label-7' })")).then(
      () => null,
      (e: unknown) => e,
    )
    expect((err as Error).message.startsWith('cli_call_bypassed_runbatch')).toBe(true)
    expect((err as Error).message).toContain('other-label-7')
  })

  it('AC2: the rejected call reaches the executor 0 times and writes no metrics line', async () => {
    const { run, executor, repoRoot } = setup()
    await expect(
      run(bundle("return await agent('p', { agentType: 'datum-cli', label: 'leak' })")),
    ).rejects.toThrow(/cli_call_bypassed_runbatch/)
    expect(executor.requests.length).toBe(0)
    expect(metricsFiles(repoRoot)).toEqual([])
  })

  it('AC2: a non-cli agentType still reaches the executor once (guard is specific to datum-cli)', async () => {
    const { run, executor, repoRoot } = setup()
    await run(bundle("await agent('p', { agentType: 'datum-red', label: 'ok-call' }); return 1"))
    expect(executor.requests.length).toBe(1)
    expect(metricsFiles(repoRoot).length).toBe(1)
  })
})

describe('agent-types datumRuntime override', () => {
  it('AC3: with globalThis.datumRuntime = { agentTypes: true }, readAgentTypeConfig({ agent_types: false }).agentTypes is true', () => {
    g.datumRuntime = { agentTypes: true }
    expect(readAgentTypeConfig({ agent_types: false }).agentTypes).toBe(true)
  })

  it("AC3: after configureAgentTypes from the overridden config, stageOpts('cli', { label: 'x' }).agentType is 'datum-cli'", () => {
    g.datumRuntime = { agentTypes: true }
    configureAgentTypes(readAgentTypeConfig({ agent_types: false }))
    expect(stageOpts('cli', { label: 'x' }).agentType).toBe('datum-cli')
  })

  it('AC4: without the override, readAgentTypeConfig({ agent_types: false }).agentTypes is false', () => {
    expect(readAgentTypeConfig({ agent_types: false }).agentTypes).toBe(false)
  })

  it('AC4: without the override, stageOpts omits agentType when agent_types is false', () => {
    configureAgentTypes(readAgentTypeConfig({ agent_types: false }))
    const opts = stageOpts('cli', { label: 'x' })
    expect(opts).toEqual({ label: 'x' })
    expect('agentType' in opts).toBe(false)
  })

  it('AC4: an override object without agentTypes: true does not force the switch on (negative path)', () => {
    g.datumRuntime = {}
    expect(readAgentTypeConfig({ agent_types: false }).agentTypes).toBe(false)
  })

  it('AC4: hooksInstalled parsing is unchanged by the override', () => {
    g.datumRuntime = { agentTypes: true }
    expect(readAgentTypeConfig({ agent_types: false, hooks_installed: true })).toEqual({
      agentTypes: true,
      hooksInstalled: true,
    })
    expect(readAgentTypeConfig({ agent_types: false })).toEqual({ agentTypes: true, hooksInstalled: false })
  })
})

describe('runBundle datumRuntime lifecycle', () => {
  it('AC3: while a bundle runs, globalThis.datumRuntime.agentTypes is true', async () => {
    const { run } = setup()
    const out = await run(bundle('return globalThis.datumRuntime && globalThis.datumRuntime.agentTypes'))
    expect(out).toBe(true)
  })

  it('AC5: runBundle removes the override after a bundle resolves', async () => {
    const { run } = setup()
    expect(await run(bundle('return 7'))).toBe(7)
    expect('datumRuntime' in g).toBe(false)
    expect(readAgentTypeConfig({ agent_types: false }).agentTypes).toBe(false)
  })

  it('AC5: runBundle removes the override after a bundle rejects', async () => {
    const { run } = setup()
    await expect(run(bundle("throw new Error('boom')"))).rejects.toThrow('boom')
    expect('datumRuntime' in g).toBe(false)
    expect(readAgentTypeConfig({ agent_types: false }).agentTypes).toBe(false)
  })

  it('AC5: runBundle removes the override after the datum-cli guard rejects', async () => {
    const { run } = setup()
    await expect(
      run(bundle("return await agent('p', { agentType: 'datum-cli', label: 'leak' })")),
    ).rejects.toThrow(/cli_call_bypassed_runbatch/)
    expect('datumRuntime' in g).toBe(false)
  })
})
