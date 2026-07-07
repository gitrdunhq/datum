import { model } from './shared/models'
import type { MergeArgs } from './shared/types'
import { filterGreenLanes } from './shared/utils'

export const meta = {
  name: 'datum-tdd-act-merge',
  description: 'Squash-merge completed lanes in topological order, then cleanup worktrees',
  phases: [{ title: 'Merge' }, { title: 'Cleanup' }],
}

const a = args as MergeArgs

// ── Merge ──
phase('Merge')

// GREEN or it doesn't merge: a lane whose last recorded stage is RED never
// squash-merges onto the epic branch, even if something upstream marked it
// 'completed' — it's left in place on its own lane branch and reported.
const { greenIds, redOnlyIds } = filterGreenLanes(a.completedIds, a.results)

for (const id of redOnlyIds) {
  log(`[${id}] left in place, not merged — stage is RED (branch: ${a.epicBranch}--${id})`)
}

if (greenIds.length === 0) {
  log(`No GREEN/REFACTOR-complete lanes${a.batchTag} — skipping merge`)
} else {
  const mergeOrder = a.topoOrder.filter(id => greenIds.includes(id))
  await agent(
    `datum worktrees merge --epic-branch ${a.epicBranch} --lane-order ${mergeOrder.join(',')} ` +
    `--commit-message "act(${a.batchRunId}): merge ${greenIds.length} lanes"`,
    { label: `merge${a.batchTag}`, phase: 'Merge', model: model('fast') }
  )
  log(`Merged${a.batchTag} in order: [${mergeOrder.join(' → ')}]`)
}

// ── Cleanup ──
phase('Cleanup')

await agent(
  `datum worktrees cleanup --run-id ${a.batchRunId} --epic-branch ${a.epicBranch}`,
  { label: `cleanup${a.batchTag}`, phase: 'Cleanup', model: model('fast') }
)

export const __workflowResult = { merged: a.completedIds.length > 0 }
