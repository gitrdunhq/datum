// Static tripwire for the stageOpts-before-configureAgentTypes ordering bug
// (reported by a dogfooding session running with `agent_types: false`: the
// run died in datum-refine with "agent type 'datum-cli' not found" because
// the config read itself was issued with agentType 'datum-cli').
//
// The runtime guard in agent-types.ts (stageOpts throws when unconfigured)
// only fires inside the workflow sandbox, which vitest never executes — so
// this file reads every top-level script and checks the ORDER in the
// source: the first `stageOpts(` call must come after the first
// `configureAgentTypes(` call, and any agent() call that has to happen
// before configuration (the config/context read) must use bootstrapOpts().
//
// datum-tdd-act-lane.ts is exempt: its stageOpts calls sit inside lane
// functions that the DAG scheduler invokes after the module-level
// configureAgentTypes(cfg.agentTypes) at the bottom of the file, so the
// textual order is misleading and the runtime guard covers it.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = join(__dirname, '..')
const EXEMPT = new Set(['datum-tdd-act-lane.ts'])

const scripts = readdirSync(srcDir)
  .filter((f) => /^datum-.*\.ts$/.test(f) && !f.endsWith('.test.ts') && !EXEMPT.has(f))

function firstCallIndex(src: string, fn: string): number {
  // Skip the import line: find the first occurrence that is followed by `(`
  // and is not part of an import specifier list.
  const re = new RegExp(`(?<![\\w.])${fn}\\(`, 'g')
  const m = re.exec(src)
  return m ? m.index : -1
}

describe('configureAgentTypes runs before the first stageOpts in every top-level script', () => {
  it('finds the scripts', () => {
    expect(scripts.length).toBeGreaterThan(8)
  })

  for (const file of scripts) {
    it(file, () => {
      const src = readFileSync(join(srcDir, file), 'utf8')
      const configureAt = firstCallIndex(src, 'configureAgentTypes')
      const stageAt = firstCallIndex(src, 'stageOpts')
      if (stageAt === -1) return // script never routes through stageOpts
      expect(configureAt, `${file}: configureAgentTypes() never called`).not.toBe(-1)
      expect(
        stageAt,
        `${file}: stageOpts( at ${stageAt} precedes configureAgentTypes( at ${configureAt} — use bootstrapOpts() for the pre-config read`,
      ).toBeGreaterThan(configureAt)
    })
  }
})

describe('child scripts configure from the parent switches before any read', () => {
  // Every script datum-go launches receives `agentTypes` in args. Honouring
  // it FIRST (before the local config read) is what makes `agent_types:
  // false` in the parent hold for the whole pipeline.
  const children = ['datum-refine.ts', 'datum-plan.ts', 'datum-properties.ts', 'datum-validate.ts', 'datum-review.ts', 'datum-closeout.ts']
  for (const file of children) {
    it(`${file} calls configureAgentTypes(a.agentTypes) before its first agent() call`, () => {
      const src = readFileSync(join(srcDir, file), 'utf8')
      const configureAt = src.search(/configureAgentTypes\(a\.agentTypes\b/)
      const firstAgentAt = src.search(/await agent\(/)
      expect(configureAt, `${file}: no configureAgentTypes(a.agentTypes)`).not.toBe(-1)
      expect(configureAt, `${file}: first agent() call precedes configureAgentTypes(a.agentTypes)`).toBeLessThan(firstAgentAt)
    })
  }
})
