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

  it('on a partial merge, demotes only the lanes the merge did not land (elonchesd wf_4f1e41dd-ab7 batch 3/5)', () => {
    expect(src).toMatch(/const landed = new Set\(mergeResult && Array\.isArray\(mergeResult\.mergedIds\) \? mergeResult\.mergedIds : \[\]\)/)
    expect(src).toMatch(/const unmerged = mergedIds\.filter\(\(?id\)? => !landed\.has\(id\)\)/)
    expect(src).toMatch(/for \(const id of unmerged\) \{/)
    expect(src).not.toMatch(/for \(const id of mergedIds\) \{[^}]*status: 'failed', stage: 'MERGE'/)
    expect(src).toMatch(/failedLane/)
  })
})

describe('docs workflow result is consumed, not discarded', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act.ts'), 'utf8')

  it('captures the datum-tdd-act-docs result and surfaces a refused docs commit', () => {
    expect(src).toMatch(/docs\w* = await workflow\(\s*\{ scriptPath: sk\('datum-tdd-act-docs'\) \}/)
    expect(src).toMatch(/docs[^\n]*committed === false|docs[^\n]*failure_reason/)
  })
})

describe('lane plan reaches the scheduler as a byte-verified digest, never an LLM echo', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act.ts'), 'utf8')
  it('parses the digest with lanePlanDigestFromSteps, halts on its named failures, and uses digest spec hashes', () => {
    expect(src).not.toMatch(/contextChunkPlan|contextChunkSteps|contextAssembleChunks|verifyLanePlanShape/)
    expect(src).toMatch(/const digestResult = lanePlanDigestFromSteps\(actStartResult, lanePlanPath\)/)
    expect(src).toMatch(/if \(!digestResult\.ok \|\| !digestResult\.digest\) throw new Error\(digestResult\.error\)/)
    expect(src).toMatch(/const lanePlan: LanePlanDigest = digestResult\.digest/)
    expect(src).not.toMatch(/laneSpecHash\(lanePlan\.lanes\[/)
    expect(src).toMatch(/digestSpecHash\(lanePlan, id\)/)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix — the standalone config read no longer relays through
// READ_CONFIG_PROMPT (an LLM "read two configs and merge them by hand"),
// it uses the same shared/config-steps.ts batch as datum-plan.ts /
// datum-validate.ts.
// ---------------------------------------------------------------------------

describe('lane plan is never read by a reader agent', () => {
  it('no longer imports or calls readLanePlanPrompt or dispatches a reader-type agent for the plan', () => {
    expect(src).not.toMatch(/readLanePlanPrompt/)
    expect(src).not.toMatch(/stageOpts\('reader'/)
  })
})

describe('determinism fix — config read is a deterministic batch, not an LLM relay', () => {
  it('no longer imports or calls agent(READ_CONFIG_PROMPT ...)', () => {
    expect(src).not.toMatch(/READ_CONFIG_PROMPT/)
  })

  it('imports configReadSteps/configFromSteps from shared/config-steps', () => {
    expect(src).toMatch(/import\s*\{[^}]*configReadSteps[^}]*configFromSteps[^}]*\}\s*from\s*'\.\/shared\/config-steps'/)
  })
})

// Phase review wf_9a69f891-462: the triage child workflow was awaited bare,
// so a triage crash escaped as an Act crash after every lane had already
// finished; and its counts were never read.
describe('triage child workflow is guarded and its counts are logged', () => {
  for (const f of ['datum-tdd-act.ts', 'datum-go.ts']) {
    it(`${f} wraps the triage workflow in try/catch (triage_workflow_failed) and logs filed/consumer_findings/skipped`, () => {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src).toMatch(/try \{\s*const triage = await workflow\(\s*\{ scriptPath: sk\('datum-tdd-act-triage'\) \}/)
      expect(src).toMatch(/triage_workflow_failed/)
      expect(src).toMatch(/Triage: \$\{triage\?\.filed \?\? 0\} filed, \$\{triage\?\.consumer_findings \?\? 0\} consumer finding\(s\), \$\{triage\?\.skipped \?\? 0\} skipped/)
    })
  }
})

// caliper BUG L: a GREEN blocked on files outside its scope is not a
// dependency block — both orchestrators name it, list it, and hand it to
// triage even when no lane failed.
describe('GREEN needs-write blocks are surfaced and triaged in both orchestrators', () => {
  for (const f of ['datum-tdd-act.ts', 'datum-go.ts']) {
    it(`${f} lists needs-write lanes under LEAD APPROVAL NEEDED and runs triage for them`, () => {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src).toMatch(/LEAD APPROVAL NEEDED/)
      expect(src).toMatch(/const \w*[nN]eedsWrite\w* = \w+\.filter\(/)
      expect(src).toMatch(/if \((actFailures|failures)\.length > 0 \|\| \w*[nN]eedsWrite\w*\.length > 0\)/)
      expect(src).toMatch(/failures: \[\.\.\.(actFailures|failures), \.\.\.\w*[nN]eedsWrite\w*\]/)
    })
  }
})

// Phase review wf_9a69f891-462, datum-tdd-act.ts: a throw inside a batch
// (setup, lane runner, merge) aborted the whole script with no summary and
// no triage although earlier batches had merged; and the standalone entry
// point never passed skeletonDir, so every lane regenerated its skeleton.
describe('datum-tdd-act — a batch failure is contained and the Plan skeletons are reused', () => {
  const src = readFileSync(join(__dirname, 'datum-tdd-act.ts'), 'utf8')
  it('wraps each batch in try/catch and records act_batch_failed on the batch lanes', () => {
    expect(src).toMatch(/for \(let bi = 0; bi < batches\.length; bi\+\+\) \{[\s\S]{0,1600}try \{/)
    expect(src).toMatch(/act_batch_failed: batch \$\{bi \+ 1\}/)
    expect(src).toMatch(/results\[id\] = \{ task_id: id, status: 'failed', stage: 'CRASH', error: `act_batch_failed/)
  })
  it('passes skeletonDir (docs/epics/<branch>/skeletons) to the lane runner cfg', () => {
    expect(src).toMatch(/const skeletonDir = `docs\/epics\/\$\{epicBranch\}\/skeletons`/)
    expect(src).toMatch(/cfg: \{[^\n]*skeletonDir[^\n]*\}/)
  })
})

describe('the Act result reports needs-write lanes apart from dependency blocks', () => {
  for (const f of ['datum-tdd-act.ts', 'datum-go.ts']) {
    it(`${f} exposes approvalLanes/needsApproval and excludes them from the blocked count`, () => {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src).toMatch(/approvalLanes: \w*[nN]eedsWrite\w*/)
      expect(src).toMatch(/needsApproval/)
      expect(src).toMatch(/blocked: \w+\.(filter\(id => !\w*[nN]eedsWrite\w*\.includes\(id\)\)\.length|length)/)
    })
  }
})
