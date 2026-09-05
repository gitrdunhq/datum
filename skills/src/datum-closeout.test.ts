// datum-closeout.ts receives the Act run id deterministically from datum-go
// (`{ ...phaseArgs, runId: resolvedRunId }`). It then asked an LLM to echo it
// back inside the collect JSON and preferred the echoed value
// (`ctx.run_id || runId`) — so when the model generated a fresh timestamp
// instead of echoing, Closeout ran against a run id that never existed
// (20260904-193814 vs Act's 20260904-190313, eedom run wf_2a5ede48-358).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-closeout.ts'), 'utf8')

describe('datum-closeout — run id provenance', () => {
  it('prefers the deterministic runId argument over the LLM-relayed timestamp', () => {
    expect(src).toMatch(/const rid: string = runId \|\|/)
  })
})

// #368 follow-up: the collect prompt handed an LLM `... 2>/dev/null || true`
// for every collector — failures were swallowed, the model decided what to
// report, and nothing said WHICH collector failed (eedom wf_2a5ede48-358).
// Collection is now one deterministic batched datum-cli call built from
// closeoutCollectSteps(), evaluated by the script, not a model.
const collectSection = src.slice(0, src.indexOf('// ── Synthesize'))

describe('datum-closeout — deterministic collect (#368 follow-up)', () => {
  it('does not swallow collector failures with || true or 2>/dev/null (collect section only — synth prompt text is unchanged)', () => {
    expect(collectSection.length).toBeGreaterThan(0)
    expect(collectSection).not.toMatch(/\|\|\s*true\b/)
    expect(collectSection).not.toContain('2>/dev/null')
  })

  it('builds the collect batch from closeoutCollectSteps, not an LLM-relayed prompt', () => {
    expect(src).toContain("import { closeoutCollectSteps } from './shared/lane-steps'")
    expect(src).toMatch(/closeoutCollectSteps\(/)
    expect(src).toMatch(/batchCommandPrompt\(collectSteps\)/)
    expect(src).toMatch(/parseBatchResult\(/)
  })

  it('logs every collector that exited non-zero, by name', () => {
    expect(src).toMatch(/collect-git|COLLECTOR_STEPS/)
    expect(src).toMatch(/exit_code/)
    expect(src).toMatch(/log\(/)
  })

  it('gates the synthesize agent on data-exists — never hands a model a missing closeout-data.json', () => {
    const collectIdx = src.indexOf('closeoutCollectSteps(')
    const dataExistsIdx = src.indexOf("'data-exists'")
    const synthIdx = src.lastIndexOf('closeoutSynthTemplate')
    expect(collectIdx).toBeGreaterThan(-1)
    expect(dataExistsIdx).toBeGreaterThan(collectIdx)
    expect(synthIdx).toBeGreaterThan(dataExistsIdx)
    expect(src).toMatch(/throw new Error/)
  })
})
