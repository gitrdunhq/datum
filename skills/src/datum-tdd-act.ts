import { model, setModelTiers } from './shared/models'
import type { LanePlan, LaneOutcome, SetupResult, LaneResult } from './shared/types'
import { buildWaves, packWaves, parseAgentJson, resolveLanePlanPrompt, resolveLanePlanPath, laneSpecHash, epicSlug } from './shared/utils'
import { laneStateReadPrompt, laneStateWritePrompt } from './shared/prompts'
import { READ_CONFIG_PROMPT, DEFAULT_CONFIG, skillPath } from './shared/models'
import detectBranchPrompt from './prompts/util-detect-branch.md'

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
  ? await agent(READ_CONFIG_PROMPT, { label: 'read-config', model: model('fast') })
  : null
const repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) as Record<string, any> : {}
if (repoCfg.models && typeof repoCfg.models === 'object') setModelTiers(repoCfg.models)
const sk = (name: string) => skillPath(repoCfg.skills_dir || '', name)
const testCommand: string = a.testCommand || repoCfg.test_command || DEFAULT_CONFIG.test_command
const language: string = a.language || repoCfg.language || DEFAULT_CONFIG.language
const test_framework: string | undefined = a.test_framework || repoCfg.test_framework

let epicBranch: string = a.epicBranch
let runId: string = a.runId

// yolo mode: auto-detect branch and generate runId via agent
const branchInfo = a.yolo
  ? await agent(detectBranchPrompt, { label: 'yolo-detect', model: model('fast') })
  : null

if (branchInfo) {
  const info = parseAgentJson(branchInfo, { branch: '', timestamp: '' }) as { branch: string; timestamp: string }
  epicBranch = epicBranch || info.branch
  runId = runId || info.timestamp
}

if (!epicBranch) throw new Error('args.epicBranch is required. Pass {epicBranch, runId} or "yolo" to auto-detect.')
if (!runId) throw new Error('args.runId is required. Pass {epicBranch, runId} or "yolo" to auto-detect.')

const epicDir: string = `docs/epics/${epicBranch}`
// ── Lane-plan resolution: check lane-plan-final.json first (version drift #232/#237) ──
let lanePlanPath: string = a.lanePlanPath || ''
if (!lanePlanPath) {
  const resolveText = await agent(
    resolveLanePlanPrompt(epicDir),
    { label: 'resolve-lane-plan', phase: 'Topology', model: model('fast') }
  )
  lanePlanPath = resolveLanePlanPath(epicDir, resolveText)
}

// ── Topology ──

phase('Topology')

const planText = await agent(
  `Read ${lanePlanPath} and return its contents as raw JSON text. This is the SOLE source of truth — do NOT read tasks.json or any other file. Output ONLY the JSON, no markdown fences, no explanation.`,
  { label: 'read-plan', phase: 'Topology', model: model('fast') }
)
const lanePlan: LanePlan = typeof planText === 'string'
  ? JSON.parse(planText.replace(/```[a-z]*\n?/g, '').trim())
  : planText

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
const markerText = await agent(
  laneStateReadPrompt({ epicBranch, epicSlug: slug, taskIdsSpace: lanePlan.topological_order.join(' ') }),
  { label: 'lane-state-read', phase: 'Topology', model: model('fast') },
)
const priorMarkers = parseAgentJson(markerText, {}) as Record<string, { status: string; spec_hash: string; ancestor: boolean }>
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
const batches: string[][] = packWaves(remainingWaves, MAX_BATCH)
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
    { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, batchTag }
  ) as SetupResult

  // Act
  log('── Act ──')
  const act = await workflow(
    { scriptPath: sk('datum-tdd-act-lane') },
    {
      batchLaneIds: runnableBatchIds, lanePlan, worktreePaths: setup.worktreePaths, batchTag,
      cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, test_framework },
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

  // Merge + Cleanup
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
    }
  )

  // Persist epic-scoped completion markers so future runs/sessions skip these lanes
  if (mergedIds.length > 0) {
    const entriesJson = JSON.stringify(mergedIds.map(id => ({ task_id: id, spec_hash: laneSpecHash(lanePlan.lanes[id]) })))
    await agent(
      laneStateWritePrompt({ epicBranch, epicSlug: slug, runId: batchRunId, entriesJson }),
      { label: `lane-state-write${batchTag}`, phase: 'Act', model: model('fast') },
    )
  }
}

// ── Docs ──

log('── Docs ──')
await workflow(
  { scriptPath: sk('datum-tdd-act-docs') },
  { completedLanes, lanePlan, runId }
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
    { failures, blocked: blockedLanes.map(id => results[id]), results, lanePlan, runId, epicBranch }
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
