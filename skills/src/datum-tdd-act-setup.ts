import { model } from './shared/models'
import type { SetupArgs } from './shared/types'
import { parseAgentJson } from './shared/utils'
import { stageOpts, configureAgentTypes } from './shared/agent-types'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout, describeFailure } from './shared/batch'
import { setupSteps, laneWorktreePathsFromSteps } from './shared/lane-steps'

export const meta = {
  name: 'datum-tdd-act-setup',
  description: 'Create root + per-lane git worktrees and distribute lane plan',
  phases: [{ title: 'Setup' }],
}

const a = args as SetupArgs
configureAgentTypes(a.agentTypes || {})
setBatchCacheKey(a.configFingerprint || '')
phase('Setup')

// Root worktree, lane worktrees and lane-plan distribution — ONE datum-cli
// call (#368). The three steps have no LLM judgement between them; the
// script threads the root path and the setup JSON from one step to the next
// and stops at the first failure. Results are evaluated here, in order.
//
// The lane plan was already produced and gated by the Plan phase and is
// already committed on epicBranch at lanePlanPath — the root worktree is a
// checkout of that same branch, so the file already exists there too.
// Distribution is a deterministic file copy (datum/cli.py:
// lane-plan-distribute), never an agent handed raw plan JSON to write — see
// #327-adjacent friction where a fast-tier agent previously misread a "write
// this JSON, don't act on it" prompt as an invitation to implement the plan
// directly in the main checkout (observed 2026-07-06, epic-287 run
// 20260706-223937-b0).
const steps = setupSteps({
  batchRunId: a.batchRunId,
  epicBranch: a.epicBranch,
  laneIds: a.batchLaneIds,
  lanePlanPath: a.lanePlanPath,
})
const setupRaw = await agent(
  batchCommandPrompt(steps),
  stageOpts('cli', { label: `setup${a.batchTag}`, phase: 'Setup', model: model('fast') }),
)
const setup = parseBatchResult(setupRaw, steps)

// Safe: an unparseable result yields {} — rootWt stays undefined, which the
// throw immediately below already catches.
const rootWtInfo = parseAgentJson(stepStdout(setup, 'root-wt') || '', {}) as { root?: string }
const rootWt = rootWtInfo.root
if (!rootWt) throw new Error(`Failed to create root worktree for ${a.batchRunId} (${describeFailure(setup, 'setup')})`)
log(`Root worktree${a.batchTag}: ${rootWt}`)

// The CLI's own error JSON ({"error": ...}, exit 1) is the diagnosis and is
// thrown verbatim (caliper BUG O). Only absolute paths are kept — a lane with
// a missing/garbage entry must be dropped here so it fails fast in the lane
// scheduler instead of running in the main checkout.
const setupSummary = laneWorktreePathsFromSteps(setup)
if (setupSummary.error) throw new Error(`Setup failed for ${a.batchRunId}: ${setupSummary.error}`)
for (const d of setupSummary.dropped) {
  log(`  [warn] dropping ${d.laneId}: setup returned invalid worktree path ${JSON.stringify(d.value)}`)
}
const worktreePaths = setupSummary.paths

const validPaths = Object.values(worktreePaths)
if (validPaths.length === 0) throw new Error(`Setup failed: no worktree paths for ${a.batchRunId}`)
for (const [lid, wtp] of Object.entries(worktreePaths)) {
  log(`  worktree ${lid}: ${wtp}`)
}

if (setup.failed) {
  // Only the distribute step can still be the failure here (root/setup were checked above).
  throw new Error(`Setup failed for ${a.batchRunId}: ${describeFailure(setup, 'setup')}`)
}

log(`Setup${a.batchTag}: ${a.batchLaneIds.length} lane worktrees`)

export const __workflowResult = { worktreePaths }
