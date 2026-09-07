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
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const srcDir = join(__dirname, '..')

const scripts = readdirSync(srcDir)
  .filter((f) => /^datum-.*\.ts$/.test(f) && !f.endsWith('.test.ts'))

/** The first batch dispatch: runBatch( or a direct batchCommandPrompt( — whichever comes first. */
function firstBatchIndex(src: string): number {
  const a = firstCallIndex(src, 'runBatch')
  const b = firstCallIndex(src, 'batchCommandPrompt')
  if (a === -1) return b
  if (b === -1) return a
  return Math.min(a, b)
}

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

// Same ordering discipline for the resume cache key: every script that runs
// batches must stamp the inputs fingerprint (setBatchCacheKey) before its
// first batchCommandPrompt, or a resumed run replays stale file reads and
// stale gate verdicts (see batch.test.ts).
describe('setBatchCacheKey runs before the first batchCommandPrompt in every script', () => {
  for (const file of readdirSync(srcDir).filter((f) => /^datum-.*\.ts$/.test(f) && !f.endsWith('.test.ts'))) {
    it(file, () => {
      const src = readFileSync(join(srcDir, file), 'utf8')
      const firstBatch = firstBatchIndex(src)
      if (firstBatch === -1) return
      const keyAt = firstCallIndex(src, 'setBatchCacheKey')
      expect(keyAt, `${file}: never calls setBatchCacheKey`).not.toBe(-1)
      expect(keyAt, `${file}: first batchCommandPrompt( at ${firstBatch} precedes setBatchCacheKey( at ${keyAt}`).toBeLessThan(firstBatch)
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
      // The first dispatch of any kind: a direct agent() or a runBatch() (which calls agent() inside).
      const firstAgentAt = [src.search(/await agent\(/), src.search(/await runBatch\(/)].filter((i) => i !== -1).reduce((m, i) => Math.min(m, i), Infinity)
      expect(configureAt, `${file}: no configureAgentTypes(a.agentTypes)`).not.toBe(-1)
      expect(firstAgentAt, `${file}: no agent()/runBatch() call at all`).not.toBe(Infinity)
      expect(configureAt, `${file}: first agent()/runBatch() call precedes configureAgentTypes(a.agentTypes)`).toBeLessThan(firstAgentAt)
    })
  }
})

// And for the repo root: every script that runs batches records the root the
// parent measured at boot (setBatchRoot) before its first batchCommandPrompt,
// so a runner whose cwd drifted still runs every batch at the repo root.
describe('setBatchRoot runs before the first batchCommandPrompt in every script', () => {
  for (const file of readdirSync(srcDir).filter((f) => /^datum-.*\.ts$/.test(f) && !f.endsWith('.test.ts'))) {
    it(file, () => {
      const src = readFileSync(join(srcDir, file), 'utf8')
      const firstBatch = firstBatchIndex(src)
      if (firstBatch === -1) return
      const rootAt = firstCallIndex(src, 'setBatchRoot')
      expect(rootAt, `${file}: never calls setBatchRoot`).not.toBe(-1)
      expect(rootAt, `${file}: first batchCommandPrompt( at ${firstBatch} precedes setBatchRoot( at ${rootAt}`).toBeLessThan(firstBatch)
    })
  }
})

// Every batch goes through runBatch: the refusal retry, the corrupt-script
// retry and the large-script model routing live there, and 29 direct
// `agent(batchCommandPrompt(...))` sites had none of them (caliper #566: the
// 24 KB lane-plan batch was corrupted once and never retried).
describe('no script calls agent(batchCommandPrompt(...)) directly — every batch goes through runBatch', () => {
  for (const file of scripts) {
    it(file, () => {
      const src = readFileSync(join(srcDir, file), 'utf8')
      expect(src, `${file}: direct agent(batchCommandPrompt(...)) call — use runBatch(steps, opts)`).not.toMatch(/agent\(batchCommandPrompt\(/)
    })
  }
})
