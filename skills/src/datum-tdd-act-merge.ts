import { model } from './shared/models'
import type { MergeArgs } from './shared/types'
import { filterGreenLanes, parseAgentJson } from './shared/utils'
import { stageOpts, configureAgentTypes } from './shared/agent-types'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout, stepResult, describeFailure } from './shared/batch'
import { mergeSteps } from './shared/lane-steps'
import { laneStateWriteScript } from './shared/prompts'

export const meta = {
  name: 'datum-tdd-act-merge',
  description: 'Squash-merge completed lanes in topological order, then cleanup worktrees',
  phases: [{ title: 'Merge' }, { title: 'Cleanup' }],
}

const a = args as MergeArgs
configureAgentTypes(a.agentTypes || {})
setBatchCacheKey(a.configFingerprint || '')

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

// The outcome is what the merge STEP reported, never what we were asked to
// merge: a failed squash-merge used to return merged: true (derived from the
// input completedIds), so callers carried on to Validate/Review/Closeout on
// an unmerged epic. "Nothing to merge" is not a failure.
const mergeStep = mergeOrder.length > 0 ? stepResult(merge, 'merge') : null
const mergeOk: boolean = mergeOrder.length === 0 || (!!mergeStep && mergeStep.exit_code === 0)
// `datum worktrees merge` prints {sha, merged, already_merged} on success and
// the same plus {failed_lane, error} on a partial merge (exit 1): the lanes
// that landed before a conflicting lane are committed and kept, so callers
// demote only failed_lane (elonchesd wf_4f1e41dd-ab7 batch 3/5).
interface MergeJson { sha?: string; merged?: string[]; already_merged?: string[]; failed_lane?: string; error?: string }
const mergeJson = parseAgentJson<MergeJson | null>(mergeStep ? mergeStep.stdout : '', null)
const landedIds: string[] = mergeJson && Array.isArray(mergeJson.merged) ? mergeJson.merged : (mergeOk ? mergeOrder : [])
const failedLane: string = mergeJson && typeof mergeJson.failed_lane === 'string' ? mergeJson.failed_lane : ''
if (mergeOrder.length > 0) {
  if (mergeOk) {
    log(`Merged${a.batchTag} in order: [${mergeOrder.join(' → ')}]`)
  } else if (failedLane) {
    log(`Merge${a.batchTag} FAILED — partial merge: ${failedLane} did not land (${mergeJson?.error || 'no error text'}); landed and committed: [${landedIds.join(', ') || 'none'}]`)
  } else {
    log(`Merge${a.batchTag} FAILED: ${mergeStep ? (mergeStep.stderr || mergeStep.stdout).trim().split('\n').slice(-5).join('\n') : 'step did not run'}`)
  }
}
if (laneState) {
  const out = stepStdout(merge, 'lane-state-write') || ''
  if (out.includes('SKIPPED_MERGE_FAILED')) {
    log(`Lane-state markers${a.batchTag} NOT recorded — no lane landed`)
  } else if (out.includes('DONE')) {
    log(`Lane-state markers${a.batchTag} recorded for [${(a.laneState?.entries || []).map(e => e.task_id).filter(id => landedIds.includes(id)).join(', ')}]`)
  } else {
    log(`Lane-state markers${a.batchTag}: ${describeFailure(merge, 'lane-state-write')}`)
  }
}

// ── Cleanup ──
phase('Cleanup')

const cleanup = stepResult(merge, 'cleanup')
log(`Cleanup${a.batchTag}: ${cleanup ? (cleanup.exit_code === 0 ? 'done' : `exited ${cleanup.exit_code}`) : 'step did not run'}`)
// `worktrees cleanup` prints {"cleaned": {..., "preserved_with_commits": [...]}} —
// lane branches it refused to delete because they carry real commits. Say so.
const cleaned = cleanup && cleanup.exit_code === 0
  ? parseAgentJson<{ cleaned?: { preserved_with_commits?: string[] } } | null>(cleanup.stdout, null)
  : null
const preserved = cleaned && cleaned.cleaned && Array.isArray(cleaned.cleaned.preserved_with_commits) ? cleaned.cleaned.preserved_with_commits : []
if (preserved.length > 0) {
  log(`Cleanup${a.batchTag}: preserved lane branch(es) with real commits (not deleted): ${preserved.join(', ')}`)
}

export const __workflowResult = {
  merged: mergeOrder.length > 0 && mergeOk,
  failed: mergeOrder.length > 0 && !mergeOk,
  mergedIds: mergeJson && Array.isArray(mergeJson.merged) ? mergeJson.merged : (mergeOk ? mergeOrder : []),
  failedLane: mergeJson && typeof mergeJson.failed_lane === 'string' ? mergeJson.failed_lane : '',
}
