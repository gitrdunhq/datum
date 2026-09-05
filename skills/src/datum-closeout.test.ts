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

// #368 follow-up: the synthesize agent's prompt used to have a shell block
// appended to it — `2>/dev/null || true` on tag/archive swallowed failures,
// and `git add -A && git commit` in the ROOT checkout risked committing the
// operator's unrelated WIP. Archiving is now its own deterministic batch
// built from closeoutArchiveSteps(), run AFTER synthesis, evaluated by the
// script — never appended to an LLM prompt as free-form shell.
describe('datum-closeout — deterministic archive (#368 follow-up)', () => {
  it('never appends a shell block to the synthesize prompt: no add -A, no || true, no 2>/dev/null anywhere in the file', () => {
    expect(src).not.toContain('add -A')
    expect(src).not.toMatch(/\|\|\s*true\b/)
    expect(src).not.toContain('2>/dev/null')
  })

  it('builds and runs the archive batch from closeoutArchiveSteps after synthesis, not before', () => {
    expect(src).toContain("closeoutArchiveSteps } from './shared/lane-steps'")
    const synthIdx = src.lastIndexOf('closeoutSynthTemplate')
    const archiveStepsIdx = src.indexOf('closeoutArchiveSteps(')
    expect(archiveStepsIdx).toBeGreaterThan(synthIdx)
    expect(src).toMatch(/batchCommandPrompt\(archiveSteps\)/)
    expect(src).toMatch(/parseBatchResult\(archiveRaw, archiveSteps\)/)
  })

  it('logs every archive step that exited non-zero, by name', () => {
    const archiveSection = src.slice(src.indexOf('closeoutArchiveSteps('))
    expect(archiveSection).toMatch(/exit_code/)
    expect(archiveSection).toMatch(/log\(/)
  })

  it('the workflow result reports archived, archiveCommit and archiveFailures', () => {
    const resultShape = src.slice(src.indexOf('export const __workflowResult'))
    expect(resultShape).toMatch(/\barchived\b/)
    expect(resultShape).toMatch(/\barchiveCommit\b/)
    expect(resultShape).toMatch(/\barchiveFailures\b/)
  })

  it('a failed commit step (not tag/archive) is what flips archived to false', () => {
    expect(src).toMatch(/find\(\(s\) => s\.name === 'commit'\)/)
  })
})
