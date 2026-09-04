import { model, setModelTiers } from './shared/models'
import type { LanePlan, LaneOutcome, SetupResult, LaneResult } from './shared/types'
import { buildWaves, packWaves, parseAgentJson, resolveLanePlanPath, laneSpecHash, epicSlug } from './shared/utils'
import { laneStateReadScript } from './shared/prompts'
import { batchCommandPrompt, parseBatchResult, stepStdout, describeFailure } from './shared/batch'
import { actStartSteps, readLanePlanPrompt } from './shared/lane-steps'
import { READ_CONFIG_PROMPT, DEFAULT_CONFIG, skillPath } from './shared/models'
import { stageOpts, configureAgentTypes, readAgentTypeConfig, agentTypeArgs } from './shared/agent-types'

export const meta = {
  name: 'datum-tdd-act',
  description: 'Deterministic TDD Act: RED->GREEN->REFACTOR per lane with gate enforcement',
  phases: [],
}

// ── Parse args ──
// "yolo" mode: auto-detect epicBranch from current git branch, generate runId from timestamp

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})

// Read config from .datum/config.json if not passed as args
const cfgText = (!a.testCommand || !a.language)
  ? await agent(READ_CONFIG_PROMPT, stageOpts('reader', { label: 'read-config', model: model('fast') }))
  : null
const repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) as Record<string, any> : {}
if (repoCfg.models && typeof repoCfg.models === 'object') setModelTiers(repoCfg.models)
// #368: agent_types / hooks_installed switches for this and every child workflow.
configureAgentTypes(readAgentTypeConfig(repoCfg))
const sk = (name: string) => skillPath(repoCfg.skills_dir || '', name)
const testCommand: string = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command
const language: string = a.language || repoCfg.language || DEFAULT_CONFIG.language
const test_framework: string | undefined = a.test_framework || repoCfg.test_framework

let epicBranch: string = a.epicBranch
let runId: string = a.runId

// yolo mode: auto-detect branch and generate runId; then resolve + read the
// lane plan (lane-plan-final.json first, #232/#237) and the epic-scoped
// completion markers — ONE datum-cli call (#368) where there were four.
const actStart = actStartSteps({
  branch: epicBranch ? epicBranch : (a.yolo ? 'detect' : ''),
  lanePlanPath: a.lanePlanPath || null,
  laneStateReadScript: laneStateReadScript({
    epicBranch: '$__eb', epicSlug: '', taskIdsSpace: `$(jq -r '.topological_order[]' "$__plan")`,
  }),
})
if (!epicBranch && !a.yolo) throw new Error('args.epicBranch is required. Pass {epicBranch, runId} or "yolo" to auto-detect.')
const actStartRaw = await agent(
  batchCommandPrompt(actStart),
  stageOpts('cli', { label: 'act-start', phase: 'Topology', model: model('fast') }),
)
const actStartResult = parseBatchResult(actStartRaw, actStart)
epicBranch = epicBranch || (stepStdout(actStartResult, 'branch') || '').trim()
runId = runId || (stepStdout(actStartResult, 'timestamp') || '').trim()

if (!epicBranch) throw new Error(`args.epicBranch is required and auto-detect failed (${describeFailure(actStartResult, 'act-start')}). Pass {epicBranch, runId} or "yolo" to auto-detect.`)
if (!runId) throw new Error(`args.runId is required and auto-detect failed (${describeFailure(actStartResult, 'act-start')}). Pass {epicBranch, runId} or "yolo" to auto-detect.`)

const epicDir: string = `docs/epics/${epicBranch}`
const lanePlanPath: string = a.lanePlanPath || resolveLanePlanPath(epicDir, stepStdout(actStartResult, 'resolve') || '')

// ── Topology ──

phase('Topology')

// Read as its own dedicated agent call, not folded into the actStart batch
// (#524 dogfooding) — see readLanePlanPrompt's doc comment.
const lanePlanText = await agent(
  readLanePlanPrompt(lanePlanPath),
  stageOpts('reader', { label: 'read-lane-plan', phase: 'Topology', model: model('fast') }),
)
const lanePlan = parseAgentJson<LanePlan | null>(lanePlanText as string, null) as LanePlan
if (!lanePlan || !lanePlan.lanes) throw new Error(`Failed to parse ${lanePlanPath} — ${describeFailure(actStartResult, 'act-start')}`)

const waves = buildWaves(lanePlan)
if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
  throw new Error('Lane plan has 0 tasks — nothing to execute')
}
log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`)
for (let i = 0; i < waves.length; i++) {
  log(`  Wave ${i}: [${waves[i].join(', ')}]`)
}

// ── Epic-scoped completion markers ──
// Lanes merged in prior runs/sessions skip entirely. A marker counts only if
// status=completed, spec_hash matches the current plan entry, and merge_commit
// is an ancestor of the epic branch tip.

const slug = epicSlug(epicBranch)
const priorMarkers = parseAgentJson(stepStdout(actStartResult, 'lane-state-read') || '', {}) as Record<string, { status: string; spec_hash: string; ancestor: boolean }>
const alreadyMerged = lanePlan.topological_order.filter((id: string) => {
  const m = priorMarkers[id]
  return !!m && m.status === 'completed' && m.ancestor === true && m.spec_hash === laneSpecHash(lanePlan.lanes[id] || {})
})

const results: Record<string, LaneOutcome> = {}
const failures: string[] = []
const completedLanes: string[] = []
for (const id of alreadyMerged) {
  results[id] = { task_id: id, status: 'completed' }
  completedLanes.push(id)
}
if (alreadyMerged.length > 0) {
  log(`Epic-scoped state: ${alreadyMerged.length} lane(s) already merged, skipping: [${alreadyMerged.join(', ')}]`)
}

// ── Batch partitioning ──

const MAX_BATCH = 5
const allLaneIds = lanePlan.topological_order.filter((id: string) => !alreadyMerged.includes(id))
const remainingWaves = waves
  .map((wave) => wave.filter((id) => allLaneIds.includes(id)))
  .filter((wave) => wave.length > 0)
const batches: string[][] = packWaves(remainingWaves, MAX_BATCH, lanePlan)
log(`Wave-packed ${allLaneIds.length} tasks into ${batches.length} batches`)

if (batches.length > 1) {
  log(`Auto-partitioned ${allLaneIds.length} tasks into ${batches.length} batches (max ${MAX_BATCH}/batch)`)
  for (let b = 0; b < batches.length; b++) {
    log(`  Batch ${b}: [${batches[b].join(', ')}]`)
  }
}

// ── Batch loop ──

for (let bi = 0; bi < batches.length; bi++) {
  const batchLaneIds = batches[bi]
  const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : ''
  const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId

  if (batches.length > 1) log(`\n${'='.repeat(60)}\n=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(', ')}] ===\n${'='.repeat(60)}`)

  // Cross-batch dependency check: block lanes whose deps failed/were blocked,
  // skip lanes whose deps never ran. Failed deps are NOT satisfied deps.
  for (const lid of batchLaneIds) {
    const deps: string[] = lanePlan.lanes[lid]?.depends_on || []
    const unmet = deps.filter((d: string) => !batchLaneIds.includes(d) && !completedLanes.includes(d))
    if (unmet.length === 0) continue
    const failedDeps = unmet.filter((d: string) => failures.includes(d) || results[d]?.status === 'blocked')
    const neverRan = unmet.filter((d: string) => !failedDeps.includes(d))
    const rootCauses = failedDeps.map((d: string) => `${d}@${results[d]?.stage || '?'}`)
    const detail = [
      rootCauses.length > 0 ? `dep(s) failed/blocked: [${rootCauses.join(', ')}]` : '',
      neverRan.length > 0 ? `dep(s) never ran: [${neverRan.join(', ')}]` : '',
    ].filter(Boolean).join('; ')
    results[lid] = { task_id: lid, status: 'blocked', stage: 'SKIPPED', error: `blocked — ${detail}` }
    log(`  BLOCKED ${lid}: ${detail}`)
  }
  const runnableBatchIds = batchLaneIds.filter((id: string) => !results[id])
  if (runnableBatchIds.length === 0) {
    log(`Batch ${bi} fully skipped — all lanes have unmet deps`)
    continue
  }

  // Setup
  log('── Setup ──')
  const setup = await workflow(
    { scriptPath: sk('datum-tdd-act-setup') },
    { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, lanePlanPath, batchTag, agentTypes: agentTypeArgs() }
  ) as SetupResult

  // Act
  log('── Act ──')
  const act = await workflow(
    { scriptPath: sk('datum-tdd-act-lane') },
    {
      batchLaneIds: runnableBatchIds, lanePlan, worktreePaths: setup.worktreePaths, batchTag,
      cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, test_framework, yolo: !!a.yolo, agentTypes: agentTypeArgs() },
      priorFailures: failures,
      priorCompleted: completedLanes,
    }
  ) as LaneResult

  // Collect results
  for (const [id, r] of Object.entries(act.results || {})) {
    results[id] = r
    if (!r || r.status === 'failed') {
      failures.push(id)
      log(`  FAILED ${id}: ${r ? `${r.stage} — ${r.error}` : 'null result'}`)
    } else if (r.status === 'skipped' || r.status === 'blocked') {
      log(`  ${r.status.toUpperCase()} ${id}: ${r.error || 'dependency failed'}`)
    } else {
      completedLanes.push(id)
    }
  }
  log(`Act${batchTag} done: ${batchLaneIds.filter(id => completedLanes.includes(id)).length}/${batchLaneIds.length} succeeded`)

  // #356: a GREEN that is blocked on write access outside allowed_write_files
  // is surfaced ONCE, as a single lead-approval question — not retried blind.
  const approvals = Object.values(act.results || {}).filter(
    (r): r is LaneOutcome => !!r && r.status === 'blocked' && r.stage === 'GREEN' && Array.isArray(r.needs_write),
  )
  if (approvals.length > 0) {
    log(`\nLEAD APPROVAL NEEDED${batchTag} — GREEN is blocked on files outside allowed_write_files:`)
    for (const r of approvals) {
      log(`  ${r.task_id}: needs_write=[${(r.needs_write || []).join(', ')}]`)
      log(`    ${r.error}`)
    }
    log('  To approve: add the listed paths to that lane\'s `files` in lane-plan.json, then re-run act (datum go --start-from act). In yolo mode, paths inside src/ are widened automatically and GREEN re-runs once.')
  }

  // Merge + Cleanup. The epic-scoped completion markers (so future runs/
  // sessions skip these lanes) are written by the merge workflow in the same
  // datum-cli call as the squash merge (#368).
  log('── Merge ──')
  const mergedIds = batchLaneIds.filter(id => completedLanes.includes(id))
  await workflow(
    { scriptPath: sk('datum-tdd-act-merge') },
    {
      epicBranch,
      completedIds: mergedIds,
      results,
      batchRunId,
      topoOrder: lanePlan.topological_order,
      batchTag,
      agentTypes: agentTypeArgs(),
      laneState: mergedIds.length > 0
        ? { epicSlug: slug, entries: mergedIds.map(id => ({ task_id: id, spec_hash: laneSpecHash(lanePlan.lanes[id]) })) }
        : null,
    }
  )
}

// ── Docs ──

log('── Docs ──')
await workflow(
  { scriptPath: sk('datum-tdd-act-docs') },
  { completedLanes, lanePlan, runId, agentTypes: agentTypeArgs() }
)

// ── Summary ──

const skippedLanes = Object.keys(results).filter(id => results[id]?.status === 'skipped')
const blockedLanes = Object.keys(results).filter(id => results[id]?.status === 'blocked')

log(`\n${'═'.repeat(60)}`)
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed, ${skippedLanes.length} skipped, ${blockedLanes.length} blocked`)
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(', ')}]`)
if (failures.length > 0) {
  log(`  failed:    [${failures.join(', ')}]`)
  for (const fid of failures) {
    const r = results[fid]
    if (r) log(`    ${fid}: ${r.stage} — ${r.error}`)
  }
}
if (skippedLanes.length > 0) log(`  skipped:   [${skippedLanes.join(', ')}]`)
if (blockedLanes.length > 0) {
  log(`  blocked:   [${blockedLanes.join(', ')}]`)
  for (const bid of blockedLanes) {
    const r = results[bid]
    if (r) log(`    ${bid}: ${r.error}`)
  }
}
log(`${'═'.repeat(60)}`)

// ── Triage ──

if (failures.length > 0) {
  log('── Triage ──')
  await workflow(
    { scriptPath: sk('datum-tdd-act-triage') },
    { failures, blocked: blockedLanes.map(id => results[id]), results, lanePlan, runId, epicBranch, agentTypes: agentTypeArgs() }
  )
}

export const __workflowResult = {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  skipped: skippedLanes.length,
  blocked: blockedLanes.length,
  failedLanes: failures,
  skippedLanes,
  blockedLanes,
  completedLanes,
}
