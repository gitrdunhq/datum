import { runBatch } from './shared/agents'
import { renderPrompt, parseAgentJson, parseAgentJsonStrict } from './shared/utils'
import { model } from './shared/models'
import closeoutSynthTemplate from './prompts/closeout-synthesize.md'
import { stageOpts, bootstrapOpts, configureAgentTypes } from './shared/agent-types'
import { closeoutCollectSteps } from './shared/lane-steps'
import { closeoutArchiveSteps } from './shared/lane-steps'
import { housekeepSteps, housekeepFromSteps } from './shared/lane-steps'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
import { batchCommandPrompt, setBatchCacheKey, setBatchRoot, parseBatchResult, stepStdout, describeFailure } from './shared/batch'
import type { CloseoutArgs } from './shared/types'
import { withPreamble } from './shared/prompts'

/** Collector steps whose non-zero exit is logged individually — #368 follow-up. */
const COLLECTOR_STEPS = ['collect-git', 'collect-tasks', 'collect-token-metrics', 'collate']

export const meta = {
  name: 'datum-closeout',
  description: 'Post-merge closeout — collect data, synthesize artifacts, archive',
  phases: [
    { title: 'Collect', detail: 'run collectors + read context' },
    { title: 'Synthesize', detail: 'CURRENT_STATE, CHANGELOG, RETRO, follow-ups, tag, archive' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = ((typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})) as CloseoutArgs
const runId: string = a.runId || ''
// #368: the parent's switches are honoured BEFORE the first agent() call —
// with `agent_types: false` the collect batch below must not itself go out
// as agentType 'datum-cli' (a dogfooding run died right here).
if (a.agentTypes && typeof a.agentTypes === 'object') configureAgentTypes(a.agentTypes)
// Resume cache key (#354): collectors re-run when state or docs changed.
setBatchCacheKey(a.configFingerprint || '')
setBatchRoot(typeof a.repoRoot === 'string' ? a.repoRoot : '')

// ── Collect: one deterministic batched datum-cli call, no LLM judgement ──
//
// #368 follow-up: the old prompt handed an LLM a "run this, and if it fails,
// silently move on" instruction for every collector — every failure was
// swallowed, the model decided what to report, and nothing in the run said
// WHICH collector failed or why (eedom run wf_2a5ede48-358, synth agent
// "correctly refused" on missing data with no diagnostic trail). Each
// collector below is its own batch step so its exit code and stderr are
// individually visible; the script — not a model — decides whether to
// proceed to synthesis.

phase('Collect')

const collectSteps = closeoutCollectSteps({ runId })
const collectRaw = await agent(
  batchCommandPrompt(collectSteps),
  bootstrapOpts('cli', { label: 'closeout-collect', model: model('fast') }),
)
const collectResult = parseBatchResult(collectRaw, collectSteps)

// Every collector step is tolerant, so the batch itself reads as "ok" even
// when collectors exited 1; the failures are collected here so the halt
// below names the cause, not just the missing file (caliper BUG S).
const failedCollectors: string[] = []
for (const name of COLLECTOR_STEPS) {
  const step = collectResult.steps.find((s) => s.name === name)
  if (step && step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout).trim().split('\n').slice(-5).join('\n')
    log(`[closeout] collector "${name}" exited ${step.exit_code}${tail ? ` — ${tail}` : ''}`)
    failedCollectors.push(`${name} exited ${step.exit_code}${tail ? `: ${tail.slice(0, 300)}` : ''}`)
  }
}

const branch = (stepStdout(collectResult, 'branch') || '').trim()
// Safe: this is a deterministic `cat .datum/config.json` batch step, not an
// LLM judgement — an unparseable result only affects the agent_types
// default below (readAgentTypeConfig-style toggle), never closeout's actual
// deliverables (CURRENT_STATE/CHANGELOG/RETRO, archive).
const cfg = parseAgentJson<Record<string, unknown>>(stepStdout(collectResult, 'config') || '{}', {})

// #368: standalone run (no parent args) — the agent_types key read straight out of .datum/config.json.
if (!(a.agentTypes && typeof a.agentTypes === 'object')) configureAgentTypes({ agentTypes: cfg.agent_types !== false })

// The run id datum-go passes is the one Act actually produced; the collect
// batch only generates a fresh timestamp when none was given (standalone
// runs). Prefer the deterministic value — a "generated" run id that doesn't
// match Act's own sent Closeout to a run dir that never existed (eedom run
// wf_2a5ede48-358).
const rid: string = runId || (stepStdout(collectResult, 'timestamp') || '').trim()
const dataExists = (stepStdout(collectResult, 'data-exists') || '').trim() === 'yes'
log(`Branch: ${branch}, run: ${rid}`)

if (!dataExists) {
  const cause = failedCollectors.length > 0
    ? `Failed collectors: ${failedCollectors.join(' | ')}`
    : describeFailure(collectResult, 'closeout-collect')
  throw new Error(
    `Closeout: .datum/runs/${rid}/closeout-data.json is missing after collect — refusing to hand a synthesis agent a missing file. ${cause}`,
  )
}

// ── Synthesize: CURRENT_STATE, CHANGELOG, RETRO, follow-ups ──

phase('Synthesize')

const epicDir = `docs/epics/${branch}`

// caliper BUG U: a repo whose CHANGELOG.md release-please owns (config file
// or the header sentence, read by the collect batch) gets no hand-authored
// section — the versioned entry is generated from the conventional commits.
const changelogOwner = (stepStdout(collectResult, 'changelog-owner') || '').trim()
const changelogManaged = changelogOwner === 'release-please'
if (changelogManaged) log('changelog_skipped: CHANGELOG.md is managed by release-please — closeout writes CURRENT_STATE.md and RETRO.md only')
const preserved = (stepStdout(collectResult, 'preserve-current-state') || '').trim()
if (preserved.startsWith('moved-aside')) log(`current_state_preserved: an untracked root CURRENT_STATE.md was ${preserved}`)
const changelogInstruction = changelogManaged
  ? 'SKIP CHANGELOG.md entirely: this repository\'s CHANGELOG.md is managed by release-please and is generated from the conventional commits. Do not create, edit or mention it in artifacts_written.'
  : 'CHANGELOG.md — append entries for what shipped'

const synthResult = await agent(
  withPreamble(renderPrompt(closeoutSynthTemplate, {
    closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`,
    reviewResponsePath: `${epicDir}/REVIEW-RESPONSE.md`,
    changelogInstruction,
    branch,
    runId: rid,
  })),
  { label: 'synthesize', model: model('balanced') },
)

// Strict: `artifacts_written: []` is exactly the "[] means nothing happened,
// let the phase complete" silent fallback FLOW.md's design principle 2 warns
// about — a crashed or garbled synthesis agent must not be reported as a
// closeout that legitimately wrote zero artifacts.
if (!synthResult) {
  throw new Error('agent_output_unparseable: synthesize — (no result)')
}
const synth = typeof synthResult === 'string'
  ? parseAgentJsonStrict<{ artifacts_written: string[]; follow_up_count: number }>(synthResult as string, 'synthesize')
  : synthResult

log(`Closeout synthesis wrote: ${(synth?.artifacts_written || []).join(', ')}`)

// The agent only writes; the script commits the three tracked artifacts
// through a commitFilesSteps batch (shared/commit-steps.ts). The agent
// used to commit each file itself with its reply used only for telemetry —
// a skipped commit, or a `git add` of follow-ups.json out of the
// gitignored .datum/runs dir that stopped there, looked like success.
// follow-ups.json stays under .datum/runs (untracked by design).
const synthFiles = changelogManaged ? ['CURRENT_STATE.md', `${epicDir}/RETRO.md`] : ['CURRENT_STATE.md', 'CHANGELOG.md', `${epicDir}/RETRO.md`]
const synthCommitSteps = commitFilesSteps({ wt: '.', files: synthFiles, message: `closeout(${rid}): write ${synthFiles.map((f) => f.split('/').pop()).join(' + ')}` })
const synthCommit = commitFilesFromSteps(await runBatch(synthCommitSteps, stageOpts('cli', { label: 'commit-synthesis', model: model('fast') })))
if (synthCommit.error) throw new Error(`closeout_commit_failed: ${synthCommit.error}`)
// A missing file fails `git add` (synthCommit.error); nothing-to-commit means
// the artifacts already match HEAD — a resume after they landed.
if (synthCommit.nothingToCommit) log(`Closeout artifacts unchanged since the last run — already committed (${synthFiles.join(', ')})`)
else log(`Closeout artifacts committed (${synthCommit.sha})`)

// ── Archive: tag, datum closeout-archive, move pipeline artifacts, commit ──
//
// #368 follow-up: this used to be a shell block appended to the synthesize
// agent's own prompt — a swallow-errors-and-continue idiom on tag/archive
// hid failures invisibly, and a wildcard git-add-everything commit in the ROOT checkout
// risked committing the operator's unrelated work in progress (policy:
// root-checkout commits stage only their own paths — see
// shared/agents.ts commitStage `scope: 'allowed-only'`, commit 3bb2211).
// Archiving is now its own deterministic batch: every move is staged
// individually via `git mv`, and the script — not a model — decides
// whether the archive succeeded.

const archiveSteps = closeoutArchiveSteps({ runId: rid, branch, epicDir })
const archiveRaw = await agent(
  batchCommandPrompt(archiveSteps),
  stageOpts('cli', { label: 'closeout-archive', model: model('fast') }),
)
const archiveResult = parseBatchResult(archiveRaw, archiveSteps)

// Follow-ups (synthesis manifest + Act's skeptic minority findings): say what was filed.
const filedRaw = stepStdout(archiveResult, 'file-followups')
const filed = parseAgentJson<{ ok?: boolean; filed?: number; retained?: number; retained_below_threshold?: number; min_severity?: string; manifest?: string; tracker?: string; skipped?: boolean; reason?: string } | null>(filedRaw || '', null)
if (!filed) log(`[closeout] follow-ups: filer returned no JSON (${(filedRaw || '').trim().slice(0, 120) || 'nothing'})`)
else if (filed.skipped) log('[closeout] follow-ups: already filed for this run')
else {
  log(`[closeout] follow-ups: ${filed.filed ?? 0} filed, ${filed.retained ?? 0} retained in .datum/runs/${rid}/follow-ups.json${filed.tracker ? ` (tracker ${filed.tracker})` : ''}${filed.reason ? ` — ${filed.reason}` : ''}`)
  if ((filed.retained_below_threshold ?? 0) > 0) log(`[closeout] follow-ups: ${filed.retained_below_threshold} finding(s) below ${filed.min_severity || 'high'} retained locally, not filed — see ${filed.manifest || `.datum/runs/${rid}/follow-ups.json`}`)
}

const archiveFailures: string[] = []
for (const step of archiveResult.steps) {
  if (step.exit_code !== 0) {
    archiveFailures.push(step.name)
    const tail = (step.stderr || step.stdout).trim().split('\n').slice(-5).join('\n')
    log(`[closeout] archive step "${step.name}" exited ${step.exit_code}${tail ? ` — ${tail}` : ''}`)
  }
}
// A failed tag/archive is surfaced above but not fatal — the closeout
// artifacts already exist. Only a failed commit means the archive move
// itself did not land, so only that flips archived to false.
const commitStep = archiveResult.steps.find((s) => s.name === 'commit')
const archived = !archiveResult.missing && !!commitStep && commitStep.exit_code === 0
// '' rather than undefined: esbuild emits `void 0`, which trips the build's
// leaked-TypeScript grep (same note as datum-go's configFingerprint).
const archiveCommit: string = archived ? (stepStdout(archiveResult, 'commit-sha') || '').trim() : ''

// Housekeep: delete merged lane/worktree branches and pipeline-state — a
// batch step whose exit code is read (shared/lane-steps.ts). Non-fatal (the
// closeout artifacts already landed) but never silent: a failure is logged
// by name and carried on the workflow result.
const housekeepStepList = housekeepSteps(branch)
const housekeep = housekeepFromSteps(await runBatch(housekeepStepList, stageOpts('cli', { label: 'housekeep', model: model('fast') })))
if (housekeep.ok) log(`housekeep: ${housekeep.summary || 'done'}`)
else log(`housekeep: ${housekeep.error}`)

export const __workflowResult = {
  branch, runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0,
  archived,
  archiveCommit,
  archiveFailures,
  housekeepError: housekeep.error,
}
