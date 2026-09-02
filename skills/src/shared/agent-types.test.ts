// #368 — the datum-* agent definitions must actually be passed as agentType.
//
// The mapping lives in ONE table (AGENT_TYPE_TABLE) and every call site goes
// through stageOpts(). `agent_types: false` in config must omit agentType
// everywhere (the OpenAI-compatible runtime has no such option), and the
// deterministic-check gate must require BOTH the switch and hooks_installed.

import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENT_TYPE_TABLE,
  configureAgentTypes,
  agentTypesEnabled,
  hooksInstalled,
  deterministicChecks,
  stageOpts,
  readAgentTypeConfig,
  agentTypeArgs,
  type StageKind,
} from './agent-types'

const repoRoot = join(__dirname, '..', '..', '..')

beforeEach(() => {
  configureAgentTypes({ agentTypes: true, hooksInstalled: false })
})

describe('AGENT_TYPE_TABLE drift guard', () => {
  it('every agentType named in the table has a definition file in agents/', () => {
    for (const [stage, name] of Object.entries(AGENT_TYPE_TABLE)) {
      expect(existsSync(join(repoRoot, 'agents', `${name}.md`)), `${stage} -> agents/${name}.md`).toBe(true)
    }
  })

  it('maps the TDD stages to their definitions', () => {
    expect(AGENT_TYPE_TABLE.red).toBe('datum-red')
    expect(AGENT_TYPE_TABLE.green).toBe('datum-green')
    expect(AGENT_TYPE_TABLE.refactor).toBe('datum-refactor')
    expect(AGENT_TYPE_TABLE.skeptic).toBe('datum-skeptic')
    expect(AGENT_TYPE_TABLE.reflect).toBe('datum-reflect')
    expect(AGENT_TYPE_TABLE.docs).toBe('datum-docs')
    expect(AGENT_TYPE_TABLE.reader).toBe('datum-reader')
    expect(AGENT_TYPE_TABLE.cli).toBe('datum-cli')
  })
})

describe('stageOpts', () => {
  it('adds the table agentType on top of the caller opts when the switch is on', () => {
    const opts = stageOpts('red', { label: 'red:T1', model: 'sonnet', phase: 'Act' })
    expect(opts).toEqual({ label: 'red:T1', model: 'sonnet', phase: 'Act', agentType: 'datum-red' })
  })

  it('resolves every stage kind to a table entry', () => {
    for (const stage of Object.keys(AGENT_TYPE_TABLE) as StageKind[]) {
      expect(stageOpts(stage).agentType).toBe(AGENT_TYPE_TABLE[stage])
    }
  })

  it('omits agentType entirely (no undefined key) when agent_types is off', () => {
    configureAgentTypes({ agentTypes: false })
    const opts = stageOpts('cli', { label: 'x', model: 'haiku' })
    expect(opts).toEqual({ label: 'x', model: 'haiku' })
    expect('agentType' in opts).toBe(false)
  })

  it('does not mutate the caller opts object', () => {
    const extra = { label: 'y' }
    stageOpts('green', extra)
    expect(extra).toEqual({ label: 'y' })
  })
})

describe('readAgentTypeConfig', () => {
  it('defaults agent_types on and hooks_installed off', () => {
    expect(readAgentTypeConfig({})).toEqual({ agentTypes: true, hooksInstalled: false })
    expect(readAgentTypeConfig(null)).toEqual({ agentTypes: true, hooksInstalled: false })
    expect(readAgentTypeConfig('garbage')).toEqual({ agentTypes: true, hooksInstalled: false })
  })

  it('only an explicit false turns agent_types off; only an explicit true turns hooks_installed on', () => {
    expect(readAgentTypeConfig({ agent_types: false }).agentTypes).toBe(false)
    expect(readAgentTypeConfig({ agent_types: 'false' }).agentTypes).toBe(true)
    expect(readAgentTypeConfig({ hooks_installed: true }).hooksInstalled).toBe(true)
    expect(readAgentTypeConfig({ hooks_installed: 'true' }).hooksInstalled).toBe(false)
  })
})

describe('deterministicChecks gate', () => {
  it('is off by default (hooks not reported installed)', () => {
    expect(agentTypesEnabled()).toBe(true)
    expect(hooksInstalled()).toBe(false)
    expect(deterministicChecks()).toBe(false)
  })

  it('requires both agent_types and hooks_installed', () => {
    configureAgentTypes({ hooksInstalled: true })
    expect(deterministicChecks()).toBe(true)
    configureAgentTypes({ agentTypes: false })
    expect(deterministicChecks()).toBe(false)
    configureAgentTypes({ agentTypes: true, hooksInstalled: false })
    expect(deterministicChecks()).toBe(false)
  })

  it('agentTypeArgs round-trips through configureAgentTypes for child workflows', () => {
    configureAgentTypes({ agentTypes: false, hooksInstalled: true })
    const passed = agentTypeArgs()
    configureAgentTypes({ agentTypes: true, hooksInstalled: false })
    configureAgentTypes(passed)
    expect(agentTypesEnabled()).toBe(false)
    expect(hooksInstalled()).toBe(true)
  })
})
