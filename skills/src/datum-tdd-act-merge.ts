import { model } from './shared/models'
import type { MergeArgs } from './shared/types'
import { filterGreenLanes } from './shared/utils'
import { stageOpts, configureAgentTypes } from './shared/agent-types'
import { batchCommandPrompt, parseBatchResult, stepStdout, stepResult, describeFailure } from './shared/batch'
import { mergeSteps } from './shared/lane-steps'
import { laneStateWriteScript } from './shared/prompts'

export const meta = {
  name: 'datum-tdd-act-merge',
  description: 'Squash-merge completed lanes in topological order, then cleanup worktrees',
  phases: [{ title: 'Merge' }, { title: 'Cleanup' }],
}

const a = args as MergeArgs
configureAgentTypes(a.agentTypes || {})

// ── Merge ──
phase('Merge')

// GREEN or it doesn't merge: a lane whose last recorded stage is RED never
// squash-merges onto the epic branch, even if something upstream marked it
// 'completed' — it's left in place on its own lane branch and reported.
const { greenIds, redOnlyIds } = filterGreenLanes(a.completedIds, a.results)

for (const id of redOnlyIds) {
  log(`[${id}] left in place, not merged — stage is RED (branch: ${a.epicBranch}--${id})`)
}

const mergeOrder = greenIds.length === 0 ? [] : a.topoOrder.filter(id => greenIds.includes(id))
if (mergeOrder.length === 0) log(`No GREEN/REFACTOR-complete lanes${a.batchTag} — skipping merge`)

// Per-lane completion markers (.datum/runs/<runId>/lane-state/<task>.json,
// read by the lane's cross-run completion check), the squash merge, the
// epic-scoped `datum lane-state write` markers and the worktree cleanup —
// ONE datum-cli call (#368). Four separate command-runner agents before.
// The lane-state step is skipped inside the script when the merge exited
// non-zero, so a failed merge can no longer record lanes as merged.
const laneState = a.laneState && a.laneState.entries.length > 0
  ? laneStateWriteScript({
      epicBranch: a.epicBranch,
      epicSlug: a.laneState.epicSlug,
      runId: a.batchRunId,
      entriesJson: JSON.stringify(a.laneState.entries),
    })
  : null
const steps = mergeSteps({
  batchRunId: a.batchRunId,
  epicBranch: a.epicBranch,
  completedIds: a.completedIds,
  mergeOrder,
  laneStateWriteScript: laneState,
})
const mergeRaw = await agent(
  batchCommandPrompt(steps),
  stageOpts('cli', { label: `merge${a.batchTag}`, phase: 'Merge', model: model('fast') }),
)
const merge = parseBatchResult(mergeRaw, steps)
if (merge.missing) log(`Merge${a.batchTag}: ${describeFailure(merge, 'merge batch')}`)

if (mergeOrder.length > 0) {
  const m = stepResult(merge, 'merge')
  if (m && m.exit_code === 0) {
    log(`Merged${a.batchTag} in order: [${mergeOrder.join(' → ')}]`)
  } else {
    log(`Merge${a.batchTag} FAILED: ${m ? (m.stderr || m.stdout).trim().split('\n').slice(-5).join('\n') : 'step did not run'}`)
  }
}
if (laneState) {
  const out = stepStdout(merge, 'lane-state-write') || ''
  if (out.includes('SKIPPED_MERGE_FAILED')) {
    log(`Lane-state markers${a.batchTag} NOT recorded — merge failed`)
  } else if (out.includes('DONE')) {
    log(`Lane-state markers${a.batchTag} recorded for [${(a.laneState?.entries || []).map(e => e.task_id).join(', ')}]`)
  } else {
    log(`Lane-state markers${a.batchTag}: ${describeFailure(merge, 'lane-state-write')}`)
  }
}

// ── Cleanup ──
phase('Cleanup')

const cleanup = stepResult(merge, 'cleanup')
log(`Cleanup${a.batchTag}: ${cleanup ? (cleanup.exit_code === 0 ? 'done' : `exited ${cleanup.exit_code}`) : 'step did not run'}`)

export const __workflowResult = { merged: a.completedIds.length > 0 }
