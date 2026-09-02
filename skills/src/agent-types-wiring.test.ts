// #368 — every agent() call site in the lane pipeline scripts must resolve
// its agentType from the shared table via stageOpts(), so that:
//   - with agent_types on, each call carries a datum-* agentType
//   - with agent_types off, no call carries one
//
// The workflow scripts are sandbox programs (host-injected `agent`, `args`,
// ...) and cannot be imported by vitest, so this walks the TypeScript source
// for call sites and checks each one's opts argument. The "does stageOpts
// honour the switch" half is unit-tested in shared/agent-types.test.ts; the
// two together give the on/off guarantee.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENT_TYPE_TABLE, configureAgentTypes, stageOpts } from './shared/agent-types'

/** Files where 100% of agent() call sites must be table-mapped. */
const FULLY_MAPPED = [
  'datum-tdd-act-lane.ts',
  'datum-tdd-act-setup.ts',
  'datum-tdd-act-merge.ts',
  'shared/agents.ts',
  'shared/tracker.ts',
]

/** Files where command runners / stage agents are mapped but author or
 *  review-domain agents deliberately stay on the runtime default. */
const PARTIALLY_MAPPED: Record<string, number> = {
  'datum-tdd-act-docs.ts': 1,
  'datum-validate.ts': 3,
  'datum-plan.ts': 6,
  'datum-refine.ts': 1,
  'datum-properties.ts': 1,
  'datum-closeout.ts': 1,
  'datum-go.ts': 3,
  'datum-tdd-act.ts': 2,
}

interface CallSite { file: string; line: number; args: string }

/** Find `agent(` / `resilientAgent(` call expressions and return their argument text. */
function findCallSites(file: string, src: string): CallSite[] {
  const sites: CallSite[] = []
  const re = /(?<![\w.$])(?:agent|resilientAgent)\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    // skip declarations / definitions: `function agent(`, `agentFn(`
    const before = src.slice(Math.max(0, m.index - 20), m.index)
    if (/function\s+$/.test(before)) continue
    // skip mentions inside a line comment
    const lineStart = src.lastIndexOf('\n', m.index) + 1
    if (src.slice(lineStart, m.index).includes('//')) continue
    let depth = 0
    let i = m.index + m[0].length - 1
    let inStr: string | null = null
    for (; i < src.length; i++) {
      const ch = src[i]
      if (inStr) {
        if (ch === '\\') { i++; continue }
        if (ch === inStr) inStr = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue }
      if (ch === '(') depth++
      else if (ch === ')') { depth--; if (depth === 0) break }
    }
    const args = src.slice(m.index + m[0].length, i)
    const line = src.slice(0, m.index).split('\n').length
    sites.push({ file, line, args })
  }
  return sites
}

function stageOf(site: CallSite): string | null {
  const m = site.args.match(/stageOpts\(\s*'([a-z]+)'/)
  return m ? m[1] : null
}

const srcDir = __dirname

describe('#368 — agentType wiring via stageOpts', () => {
  for (const file of FULLY_MAPPED) {
    it(`${file}: every agent() call site resolves an agentType from the table`, () => {
      const sites = findCallSites(file, readFileSync(join(srcDir, file), 'utf8'))
      expect(sites.length, `${file} should have agent() call sites`).toBeGreaterThan(0)
      for (const site of sites) {
        const stage = stageOf(site)
        expect(stage, `${file}:${site.line} agent(...) must pass stageOpts('<stage>', ...)`).not.toBeNull()
        expect(Object.keys(AGENT_TYPE_TABLE), `${file}:${site.line} unknown stage '${stage}'`).toContain(stage)
      }
    })
  }

  for (const [file, minMapped] of Object.entries(PARTIALLY_MAPPED)) {
    it(`${file}: at least ${minMapped} call site(s) are table-mapped and every mapped stage is known`, () => {
      const sites = findCallSites(file, readFileSync(join(srcDir, file), 'utf8'))
      const mapped = sites.map(stageOf).filter((s): s is string => s !== null)
      expect(mapped.length, `${file} mapped call sites`).toBeGreaterThanOrEqual(minMapped)
      for (const s of mapped) expect(Object.keys(AGENT_TYPE_TABLE)).toContain(s)
    })
  }

  it('no script passes a literal agentType outside the table', () => {
    for (const file of [...FULLY_MAPPED, ...Object.keys(PARTIALLY_MAPPED)]) {
      const src = readFileSync(join(srcDir, file), 'utf8')
      expect(src, `${file} must not hard-code agentType:`).not.toMatch(/agentType\s*:/)
    }
  })

  it('the lane TDD stages map to their dedicated definitions', () => {
    const src = readFileSync(join(srcDir, 'datum-tdd-act-lane.ts'), 'utf8')
    const sites = findCallSites('lane', src)
    const byLabel = (needle: string) => sites.filter((s) => s.args.includes(needle)).map(stageOf)
    expect(byLabel('`red:${taskId}`')).toEqual(['red'])
    expect(byLabel('`red-retry:${taskId}`').every((s) => s === 'red')).toBe(true)
    expect(byLabel('`green:${taskId}`')).toEqual(['green'])
    expect(byLabel('`green-retry:${taskId}`')).toEqual(['green'])
    expect(byLabel('`green-widened:${taskId}`')).toEqual(['green'])
    expect(byLabel('`refactor:${taskId}`')).toEqual(['refactor'])
    expect(byLabel('`reflect:${taskId}`')).toEqual(['reflect'])
    expect(byLabel('`skeptic-${lens.key}:${taskId}`')).toEqual(['skeptic'])
  })

  it('with agent_types off, the same call sites produce opts without agentType', () => {
    configureAgentTypes({ agentTypes: false })
    try {
      const src = readFileSync(join(srcDir, 'datum-tdd-act-lane.ts'), 'utf8')
      for (const site of findCallSites('lane', src)) {
        const stage = stageOf(site)
        if (!stage) continue
        expect('agentType' in stageOpts(stage as keyof typeof AGENT_TYPE_TABLE, { label: 'x' })).toBe(false)
      }
    } finally {
      configureAgentTypes({ agentTypes: true })
    }
  })

  it('every script that calls stageOpts configures the switch from its config/args', () => {
    for (const file of [...FULLY_MAPPED, ...Object.keys(PARTIALLY_MAPPED)]) {
      if (file.startsWith('shared/')) continue
      const src = readFileSync(join(srcDir, file), 'utf8')
      if (!src.includes('stageOpts(')) continue
      expect(src, `${file} must call configureAgentTypes(`).toMatch(/configureAgentTypes\(/)
    }
  })
})
