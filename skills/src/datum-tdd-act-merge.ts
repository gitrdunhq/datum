import type { MergeArgs } from './shared/types'

export const meta = {
  name: 'datum-tdd-act-merge',
  description: 'Squash-merge completed lanes in topological order, then cleanup worktrees',
  phases: [{ title: 'Merge' }, { title: 'Cleanup' }],
}

const a = args as MergeArgs

// ── Merge ──
phase('Merge')

if (a.completedIds.length === 0) {
  log(`No lanes completed${a.batchTag} — skipping merge`)
} else {
  const mergeOrder = a.topoOrder.filter(id => a.completedIds.includes(id))
  await agent(
    `datum worktrees merge --epic-branch ${a.epicBranch} --lane-order ${mergeOrder.join(',')} ` +
    `--commit-message "act(${a.batchRunId}): merge ${a.completedIds.length} lanes"`,
    { label: `merge${a.batchTag}`, phase: 'Merge', model: 'haiku' }
  )
  log(`Merged${a.batchTag} in order: [${mergeOrder.join(' → ')}]`)
}

// ── Cleanup ──
phase('Cleanup')

await agent(
  `datum worktrees cleanup --run-id ${a.batchRunId} --epic-branch ${a.epicBranch} && ` +
  `git worktree remove .datum/worktrees/${a.batchRunId}-root --force 2>/dev/null; ` +
  `git worktree prune`,
  { label: `cleanup${a.batchTag}`, phase: 'Cleanup', model: 'haiku' }
)

export const __workflowResult = { merged: a.completedIds.length > 0 }
