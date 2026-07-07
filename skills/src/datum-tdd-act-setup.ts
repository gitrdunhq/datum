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
const rawPaths = (typeof setupText === 'string'
  ? parseAgentJson(setupText, null)
  : setupText) as Record<string, string> | null
if (!rawPaths || typeof rawPaths !== 'object') {
  throw new Error(`Setup failed for ${a.batchRunId}: CLI output was not JSON — ${String(setupText).slice(0, 300)}`)
}

// Keep only absolute paths — a lane with a missing/garbage entry must be dropped
// here so it fails fast in the lane scheduler instead of running in the main checkout.
const worktreePaths: Record<string, string> = {}
for (const [lid, wtp] of Object.entries(rawPaths)) {
  if (typeof wtp === 'string' && wtp.startsWith('/')) {
    worktreePaths[lid] = wtp
  } else {
    log(`  [warn] dropping ${lid}: setup returned invalid worktree path ${JSON.stringify(wtp)}`)
  }
}

const validPaths = Object.values(worktreePaths)
if (validPaths.length === 0) throw new Error(`Setup failed: no worktree paths for ${a.batchRunId}`)
for (const [lid, wtp] of Object.entries(worktreePaths)) {
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
