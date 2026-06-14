import { model } from './shared/models'
import type { SetupArgs } from './shared/types'
import { parseAgentJson } from './shared/utils'

export const meta = {
  name: 'datum-tdd-act-setup',
  description: 'Create root + per-lane git worktrees and distribute lane plan',
  phases: [{ title: 'Setup' }],
}

const a = args as SetupArgs
phase('Setup')

const rootWtText = await agent(
  `git worktree add --detach .datum/worktrees/${a.batchRunId}-root ${a.epicBranch} 2>&1 && ` +
  `echo '{"root": "'$(cd .datum/worktrees/${a.batchRunId}-root && pwd)'"}'`,
  { label: `root-wt${a.batchTag}`, phase: 'Setup', model: model('fast') }
)
const rootWtInfo = parseAgentJson(rootWtText, {}) as { root?: string }
const rootWt = rootWtInfo.root
if (!rootWt) throw new Error(`Failed to create root worktree for ${a.batchRunId}`)
log(`Root worktree${a.batchTag}: ${rootWt}`)

const setupText = await agent(
  `cd "${rootWt}" && datum worktrees setup --run-id ${a.batchRunId} --epic-branch ${a.epicBranch} --lane-ids ${a.batchLaneIds.join(',')}\nReturn ONLY the JSON output, no explanation.`,
  { label: `setup-wt${a.batchTag}`, phase: 'Setup', model: model('fast') }
)
const worktreePaths: Record<string, string> = typeof setupText === 'string'
  ? JSON.parse(setupText.replace(/```[a-z]*\n?/g, '').trim())
  : setupText

const validPaths = Object.values(worktreePaths || {}).filter(Boolean)
if (validPaths.length === 0) throw new Error(`Setup failed: no worktree paths for ${a.batchRunId}`)
for (const [lid, wtp] of Object.entries(worktreePaths || {})) {
  log(`  worktree ${lid}: ${wtp}`)
}

const planJson = JSON.stringify(a.lanePlan).replace(/'/g, "'\\''")
await agent(
  `mkdir -p "${rootWt}/.datum" && printf '%s' '${planJson}' > "${rootWt}/.datum/lane-plan.json"`,
  { label: `write-plan${a.batchTag}`, phase: 'Setup', model: model('fast') }
)
const cpCmd = validPaths
  .map(p => `mkdir -p "${p}/.datum" && cp "${rootWt}/.datum/lane-plan.json" "${p}/.datum/lane-plan.json"`)
  .join(' && ')
if (cpCmd) {
  await agent(cpCmd, { label: `copy-plans${a.batchTag}`, phase: 'Setup', model: model('fast') })
}

log(`Setup${a.batchTag}: ${a.batchLaneIds.length} lane worktrees`)

export const __workflowResult = { worktreePaths }
