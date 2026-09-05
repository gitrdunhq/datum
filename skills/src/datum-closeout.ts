import { renderPrompt, parseAgentJson, parseAgentJsonStrict } from './shared/utils'
import { model } from './shared/models'
import closeoutSynthTemplate from './prompts/closeout-synthesize.md'
import { stageOpts, bootstrapOpts, configureAgentTypes } from './shared/agent-types'
import { closeoutCollectSteps } from './shared/lane-steps'
import { closeoutArchiveSteps } from './shared/lane-steps'
import { housekeepSteps, housekeepFromSteps } from './shared/lane-steps'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout, describeFailure } from './shared/batch'
import type { CloseoutArgs } from './shared/types'

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

for (const name of COLLECTOR_STEPS) {
  const step = collectResult.steps.find((s) => s.name === name)
  if (step && step.exit_code !== 0) {
    const tail = (step.stderr || step.stdout).trim().split('\n').slice(-5).join('\n')
    log(`[closeout] collector "${name}" exited ${step.exit_code}${tail ? ` — ${tail}` : ''}`)
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
  throw new Error(
    `Closeout: .datum/runs/${rid}/closeout-data.json is missing after collect — refusing to hand a synthesis agent a missing file. ${describeFailure(collectResult, 'closeout-collect')}`,
  )
}

// ── Synthesize: CURRENT_STATE, CHANGELOG, RETRO, follow-ups ──

phase('Synthesize')

const epicDir = `docs/epics/${branch}`

const synthResult = await agent(
  renderPrompt(closeoutSynthTemplate, { closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`, branch, runId: rid }),
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
const synthFiles = ['CURRENT_STATE.md', 'CHANGELOG.md', `${epicDir}/RETRO.md`]
const synthCommitSteps = commitFilesSteps({ wt: '.', files: synthFiles, message: `closeout(${rid}): write CURRENT_STATE.md + CHANGELOG.md + RETRO.md` })
const synthCommit = commitFilesFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(synthCommitSteps), stageOpts('cli', { label: 'commit-synthesis', model: model('fast') })),
  synthCommitSteps,
))
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
const housekeep = housekeepFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(housekeepStepList), stageOpts('cli', { label: 'housekeep', model: model('fast') })),
  housekeepStepList,
))
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
