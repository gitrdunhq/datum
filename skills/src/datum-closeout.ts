import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
import closeoutSynthTemplate from './prompts/closeout-synthesize.md'
import { stageOpts, configureAgentTypes } from './shared/agent-types'
import { closeoutCollectSteps } from './shared/lane-steps'
import { batchCommandPrompt, parseBatchResult, stepStdout, describeFailure } from './shared/batch'
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
  stageOpts('cli', { label: 'closeout-collect', model: model('fast') }),
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
const cfg = parseAgentJson<Record<string, unknown>>(stepStdout(collectResult, 'config') || '{}', {})

// #368: args (from datum-go) win, else the agent_types key read straight out of .datum/config.json.
configureAgentTypes(a.agentTypes && typeof a.agentTypes === 'object' ? a.agentTypes : { agentTypes: cfg.agent_types !== false })

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

// ── Synthesize + archive (collapsed into one agent) ──

phase('Synthesize')

const synthResult = await agent(
  renderPrompt(closeoutSynthTemplate, { closeoutDataPath: `.datum/runs/${rid}/closeout-data.json`, branch, runId: rid })
  + `\n\nAFTER writing artifacts, also:
1. Tag: git tag "epic/${branch}/${rid}" HEAD 2>/dev/null || true
2. Archive: datum closeout-archive --run-id ${rid} 2>/dev/null || true
3. Clean up root pipeline artifacts — move them to the epic archive dir:
   EPIC_DIR="docs/epics/${branch}"
   mkdir -p "$EPIC_DIR"
   for f in SPEC.md TASKS.md QUESTIONS.md PROPERTIES.md TICKET.md tasks.json; do
     [ -f "$f" ] && mv "$f" "$EPIC_DIR/" && echo "archived $f → $EPIC_DIR/"
   done
   [ -f .datum/lane-plan.json ] && mv .datum/lane-plan.json "$EPIC_DIR/" && echo "archived lane-plan.json → $EPIC_DIR/"
4. Commit the cleanup: git add -A && git commit -m "closeout(${rid}): archive pipeline artifacts to $EPIC_DIR"`,
  { label: 'synthesize-and-archive', model: model('balanced') },
)

const synth = typeof synthResult === 'string'
  ? parseAgentJson(synthResult as string, { artifacts_written: [], follow_up_count: 0 })
  : synthResult

log(`Closeout complete: ${(synth?.artifacts_written || []).join(', ')}`)

// Housekeep: delete merged lane/worktree branches and pipeline-state (deterministic, no LLM)
await agent(
  `Run: datum housekeep-epic ${branch}`,
  stageOpts('cli', { label: 'housekeep', model: model('fast') }),
)

export const __workflowResult = {
  branch, runId: rid,
  artifacts: synth?.artifacts_written || [],
  followUps: synth?.follow_up_count || 0,
}
