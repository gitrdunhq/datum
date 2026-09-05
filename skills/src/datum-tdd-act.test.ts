// datum-tdd-act.ts had zero dedicated test coverage — every other
// orchestrator-level workflow script (datum-go.ts, datum-plan.ts,
// datum-refine.ts, datum-review.ts, datum-validate.ts) has its own
// .test.ts file; this one didn't, despite being the standalone Act
// pipeline entry point (`datum tdd-act`) and the file datum-go.ts's
// inline Act block is deliberately kept in sync with (see #524
// dogfooding: "datum-go.ts's inline Act block exists to mirror
// datum-tdd-act.ts exactly").
//
// Source-pattern assertions against the raw .ts text, matching this
// repo's established convention for these top-level orchestrator scripts
// (agent()/workflow() calls can't be mocked in a real unit test).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-tdd-act.ts'), 'utf8')

describe('datum-tdd-act.ts — act-lane cfg construction', () => {
  it('derives test_framework from args, falling back to repoCfg, matching datum-go.ts\'s inline Act block', () => {
    expect(src).toMatch(/test_framework:\s*string\s*\|\s*undefined\s*=\s*a\.test_framework\s*\|\|\s*repoCfg\.test_framework/)
  })

  it('the cfg object passed to the act-lane workflow call includes test_framework — the exact field datum-go.ts once drifted on (#524)', () => {
    const cfgIdx = src.indexOf('cfg: { lanePlanPath')
    expect(cfgIdx).toBeGreaterThan(-1)
    const cfgLiteral = src.slice(cfgIdx, cfgIdx + 250)
    expect(cfgLiteral).toMatch(/test_framework/)
  })
})

describe('datum-tdd-act.ts — resume/completion guard', () => {
  it('filters lanes already merged (priorMarkers) out of the batch before dispatching, so a resumed run does not redo completed lanes', () => {
    expect(src).toMatch(/alreadyMerged/)
    expect(src).toMatch(/allLaneIds\s*=\s*lanePlan\.topological_order\.filter/)
  })
})

describe('datum-tdd-act.ts — batch size respects MAX_BATCH', () => {
  it('packs remaining waves into batches bounded by MAX_BATCH, not one unbounded batch', () => {
    expect(src).toMatch(/packWaves\(remainingWaves,\s*MAX_BATCH,\s*lanePlan\)/)
  })
})

// ---------------------------------------------------------------------------
// A completed lane whose squash-merge did not land shipped nothing — the
// merge workflow result must be consumed and such lanes demoted to failed
// (eedom dogfooding, run wf_2a5ede48-358).
// ---------------------------------------------------------------------------

describe('datum-tdd-act consumes the merge result', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act.ts'), 'utf8')

  it('captures the merge workflow result and demotes unmerged lanes to merge_failed', () => {
    expect(src).toMatch(/const merge\w* = await workflow\(\s*\{ scriptPath: sk\('datum-tdd-act-merge'\) \}/)
    expect(src).toMatch(/merge_failed/)
  })
})

describe('docs workflow result is consumed, not discarded', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act.ts'), 'utf8')

  it('captures the datum-tdd-act-docs result and surfaces a refused docs commit', () => {
    expect(src).toMatch(/const docs\w* = await workflow\(\s*\{ scriptPath: sk\('datum-tdd-act-docs'\) \}/)
    expect(src).toMatch(/docs[^\n]*committed === false|docs[^\n]*failure_reason/)
  })
})
