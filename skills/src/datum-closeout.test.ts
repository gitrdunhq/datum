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

// ---------------------------------------------------------------------------
// FLOW.md design principle 2 — a null/unparseable synthesize result used to
// silently become `{artifacts_written: [], follow_up_count: 0}`, exactly the
// "[] means nothing happened, let the phase complete" silent fallback that a
// crashed or garbled synthesis agent must not be indistinguishable from.
// ---------------------------------------------------------------------------

// housekeep-epic (delete merged lane branches + pipeline-state) was a runner
// told to "Run: datum housekeep-epic <branch>" with its reply discarded — a
// failed or skipped housekeep left stale lane branches and pipeline-state
// behind with nothing in the transcript. Non-fatal, but never silent.
describe('datum-closeout — housekeep is a batch step whose outcome is logged, not an LLM run whose reply is discarded', () => {
  const src = readFileSync(join(__dirname, 'datum-closeout.ts'), 'utf8')

  it('runs housekeepSteps(branch) through the batch and reads it with housekeepFromSteps', () => {
    expect(src).toMatch(/housekeepSteps\(branch\)/)
    expect(src).toMatch(/housekeepFromSteps\(await runBatch\(/)
    expect(src).not.toMatch(/Run: datum housekeep-epic/)
  })

  it('logs the named housekeep_failed reason when the step fails, and exports it on the workflow result', () => {
    expect(src).toMatch(/log\(`housekeep: \$\{housekeep\.error\}`\)/)
    expect(src).toMatch(/housekeepError: housekeep\.error/)
  })
})

// The synthesis agent wrote CURRENT_STATE.md, CHANGELOG.md, RETRO.md and
// follow-ups.json AND committed each one itself ("Commit: git add <file>
// && git commit"), reply used only for telemetry. A runner that skipped a
// commit, or tried to `git add` follow-ups.json out of the gitignored
// .datum/runs dir and stopped there, was indistinguishable from success.
// Now the agent only writes; the script commits the three tracked
// artifacts through commitFilesSteps and halts by name.
describe('datum-closeout — synthesis artifacts are committed by the script, not the agent', () => {
  const synthPrompt = readFileSync(join(__dirname, 'prompts', 'closeout-synthesize.md'), 'utf8')

  it('the synthesize prompt no longer asks the agent to commit', () => {
    expect(synthPrompt).not.toMatch(/&& git commit/)
    expect(synthPrompt).toMatch(/Do NOT git add or git commit/)
  })

  it('commits CURRENT_STATE.md, CHANGELOG.md and the epic RETRO.md through commitFilesSteps after synthesis', () => {
    const synthIdx = src.indexOf("label: 'synthesize'")
    const commitIdx = src.indexOf("commitFilesSteps({ wt: '.', files: synthFiles, message: `closeout(${rid}): write ${synthFiles.map((f) => f.split('/').pop()).join(' + ')}` })")
    expect(synthIdx).toBeGreaterThan(-1)
    expect(commitIdx).toBeGreaterThan(synthIdx)
    // CHANGELOG.md is in the list unless release-please owns it (BUG U).
    expect(src).toMatch(/const synthFiles = changelogManaged \? \[[^\]]*\] : \['CURRENT_STATE\.md', 'CHANGELOG\.md', `\$\{epicDir\}\/RETRO\.md`\]/)
    expect(src).toMatch(/commitFilesFromSteps\(await runBatch\(/)
    expect(src).toMatch(/throw new Error\(`closeout_commit_failed: /)
  })

  it('epicDir is derived before synthesis so the RETRO path is known to the commit', () => {
    const epicDirIdx = src.indexOf('const epicDir = `docs/epics/${branch}`')
    const synthIdx = src.indexOf("label: 'synthesize'")
    expect(epicDirIdx).toBeGreaterThan(-1)
    expect(epicDirIdx).toBeLessThan(synthIdx)
  })
})

describe('datum-closeout — synthesize result uses the strict parser and rejects a null result', () => {
  it('imports parseAgentJsonStrict', () => {
    expect(src).toMatch(/import \{[^}]*parseAgentJsonStrict[^}]*\} from '\.\/shared\/utils'/)
  })

  it('a null synthResult throws a named agent_output_unparseable error before parsing', () => {
    const synthIdx = src.indexOf('const synthResult = await agent(')
    const block = src.slice(synthIdx, synthIdx + 700)
    expect(block).toMatch(/if \(!synthResult\) \{/)
    expect(block).toMatch(/agent_output_unparseable/)
  })

  it('string results are parsed with parseAgentJsonStrict labelled "synthesize"', () => {
    expect(src).toMatch(/parseAgentJsonStrict<\{ artifacts_written: string\[\]; follow_up_count: number \}>\(synthResult as string, 'synthesize'\)/)
  })
})

// caliper BUG S (3): every collector step is tolerant, so describeFailure()
// said "closeout-collect: ok" while collect-tasks and collate had exited 1
// — the error named the symptom (missing file), not the cause that was
// right there in the batch result.
describe('datum-closeout — the missing-data error names the collectors that failed', () => {
  const src = readFileSync(join(__dirname, 'datum-closeout.ts'), 'utf8')
  it('collects failed collector steps with their exit codes and tails into the thrown message', () => {
    expect(src).toMatch(/const failedCollectors: string\[\] = \[\]/)
    expect(src).toMatch(/failedCollectors\.push\(`\$\{name\} exited \$\{step\.exit_code\}/)
    expect(src).toMatch(/Failed collectors: \$\{failedCollectors\.join\(' \| '\)\}/)
    expect(src).toMatch(/closeout-data\.json is missing after collect[^\n]*\$\{cause\}/)
    expect(src).not.toMatch(/missing after collect[^\n]*describeFailure\(collectResult, 'closeout-collect'\)\}`/)
  })
})

// caliper BUG U (eedom, first full completion): closeout wrote a hand-authored
// "## [Unreleased]" section into a CHANGELOG.md that release-please owns.
// The collect batch reads the owner; when it is release-please the synthesis
// prompt says skip it and the commit list omits it. The retro also
// paraphrased an accepted PERF reason into nonsense: decisions are quoted
// from REVIEW-RESPONSE.md, never restated.
describe('datum-closeout — CHANGELOG ownership and quoted review decisions', () => {
  const src = readFileSync(join(__dirname, 'datum-closeout.ts'), 'utf8')
  const prompt = readFileSync(join(__dirname, 'prompts', 'closeout-synthesize.md'), 'utf8')
  it('reads changelog-owner from the collect batch and drops CHANGELOG.md from the synthesis commit when release-please owns it', () => {
    expect(src).toMatch(/const changelogOwner = \(stepStdout\(collectResult, 'changelog-owner'\) \|\| ''\)\.trim\(\)/)
    expect(src).toMatch(/const changelogManaged = changelogOwner === 'release-please'/)
    expect(src).toMatch(/changelogManaged \? \['CURRENT_STATE\.md', `\$\{epicDir\}\/RETRO\.md`\] : \['CURRENT_STATE\.md', 'CHANGELOG\.md', `\$\{epicDir\}\/RETRO\.md`\]/)
    expect(src).toMatch(/changelog_skipped: CHANGELOG\.md is managed by release-please/)
    expect(src).toMatch(/changelogInstruction/)
  })
  it('the synthesis prompt carries the changelog instruction slot and quotes REVIEW-RESPONSE.md verbatim', () => {
    expect(prompt).toContain('{{changelogInstruction}}')
    expect(prompt).toContain('{{reviewResponsePath}}')
    expect(prompt).toMatch(/quote[^\n]*verbatim/i)
    expect(prompt).not.toMatch(/^2\. CHANGELOG\.md — append entries for what shipped$/m)
  })
})
