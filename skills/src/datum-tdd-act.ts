import type { LanePlan, LaneOutcome, SetupResult, LaneResult } from './shared/types'
import { buildWaves, parseAgentJson } from './shared/utils'

export const meta = {
  name: 'datum-tdd-act',
  description: 'Deterministic TDD Act: RED->GREEN->REFACTOR per lane with gate enforcement',
  phases: [
    { title: 'Topology', detail: 'parse lane-plan.json, BFS wave grouping, auto-partition into ≤5 task batches' },
    { title: 'Setup', detail: 'create root + per-lane git worktrees (per batch)' },
    { title: 'Act', detail: 'RED->verify->GREEN->verify->REFACTOR per lane, DAG-parallel (per batch)' },
    { title: 'Merge', detail: 'squash-merge lanes in topological order (per batch)' },
    { title: 'Cleanup', detail: 'remove worktrees (per batch)' },
    { title: 'Docs', detail: 'haiku pre-check + conditional sonnet sync (once after all batches)' },
    { title: 'Triage', detail: 'analyze failures, auto-file issues on the board' },
  ],
}

// ── Parse args ──
// "yolo" mode: auto-detect epicBranch from current git branch, generate runId from timestamp

const a = (typeof args === 'string')
  ? (args.trim().toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})

const lanePlanPath: string = a.lanePlanPath || '.datum/lane-plan.json'
const testCommand: string = a.testCommand || 'uv run pytest -x -q'
const language: string = a.language || 'python'

let epicBranch: string = a.epicBranch
let runId: string = a.runId

if (a.yolo && (!epicBranch || !runId)) {
  const branchInfo = await agent(
    `Run these two commands and return ONLY a JSON object with two fields:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "timestamp": output of \`date +%Y%m%d-%H%M%S\`
Output raw JSON only. No markdown fences, no explanation.`,
    { label: 'yolo-detect', model: 'haiku' }
  )
  const info = typeof branchInfo === 'string'
    ? JSON.parse(branchInfo.replace(/```[a-z]*\n?/g, '').trim())
    : branchInfo
  if (!epicBranch) epicBranch = info.branch
  if (!runId) runId = info.timestamp
}

if (!epicBranch) throw new Error('args.epicBranch is required. Pass {epicBranch, runId} or "yolo" to auto-detect.')
if (!runId) throw new Error('args.runId is required. Pass {epicBranch, runId} or "yolo" to auto-detect.')

// ── Topology ──

phase('Topology')

const planText = await agent(
  `Read ${lanePlanPath} and return its contents as raw JSON text. This is the SOLE source of truth — do NOT read tasks.json or any other file. Output ONLY the JSON, no markdown fences, no explanation.`,
  { label: 'read-plan', phase: 'Topology', model: 'haiku' }
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

// ── Batch partitioning ──

const MAX_BATCH = 5
const allLaneIds = lanePlan.topological_order
const batches: string[][] = []
for (let i = 0; i < allLaneIds.length; i += MAX_BATCH) {
  batches.push(allLaneIds.slice(i, i + MAX_BATCH))
}

if (batches.length > 1) {
  log(`Auto-partitioned ${lanePlan.total_lanes} tasks into ${batches.length} batches (max ${MAX_BATCH}/batch)`)
  for (let b = 0; b < batches.length; b++) {
    log(`  Batch ${b}: [${batches[b].join(', ')}]`)
  }
}

// ── Batch loop ──

const results: Record<string, LaneOutcome> = {}
const failures: string[] = []
const completedLanes: string[] = []

for (let bi = 0; bi < batches.length; bi++) {
  const batchLaneIds = batches[bi]
  const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : ''
  const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId

  if (batches.length > 1) log(`\n${'='.repeat(60)}\n=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(', ')}] ===\n${'='.repeat(60)}`)

  // Setup
  phase('Setup')
  const setup = await workflow(
    { scriptPath: 'skills/datum-tdd-act-setup.js' },
    { batchRunId, epicBranch, batchLaneIds, lanePlan, batchTag }
  ) as SetupResult

  // Act
  phase('Act')
  const act = await workflow(
    { scriptPath: 'skills/datum-tdd-act-lane.js' },
    {
      batchLaneIds, lanePlan, worktreePaths: setup.worktreePaths, batchTag,
      cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language },
      priorFailures: failures,
    }
  ) as LaneResult

  // Collect results
  for (const [id, r] of Object.entries(act.results || {})) {
    results[id] = r
    if (!r || r.status !== 'completed') {
      failures.push(id)
      log(`  FAILED ${id}: ${r ? `${r.stage} — ${r.error}` : 'null result'}`)
    } else {
      completedLanes.push(id)
    }
  }
  log(`Act${batchTag} done: ${batchLaneIds.filter(id => completedLanes.includes(id)).length}/${batchLaneIds.length} succeeded`)

  // Merge + Cleanup
  phase('Merge')
  await workflow(
    { scriptPath: 'skills/datum-tdd-act-merge.js' },
    {
      epicBranch,
      completedIds: batchLaneIds.filter(id => completedLanes.includes(id)),
      batchRunId,
      topoOrder: lanePlan.topological_order,
      batchTag,
    }
  )
}

// ── Docs ──

phase('Docs')
await workflow(
  { scriptPath: 'skills/datum-tdd-act-docs.js' },
  { completedLanes, lanePlan, runId }
)

// ── Summary ──

log(`\n${'═'.repeat(60)}`)
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed`)
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(', ')}]`)
if (failures.length > 0) {
  log(`  failed:    [${failures.join(', ')}]`)
  for (const fid of failures) {
    const r = results[fid]
    if (r) log(`    ${fid}: ${r.stage} — ${r.error}`)
  }
}
log(`${'═'.repeat(60)}`)

// ── Triage ──

if (failures.length > 0) {
  phase('Triage')
  await workflow(
    { scriptPath: 'skills/datum-tdd-act-triage.js' },
    { failures, results, lanePlan, runId, epicBranch }
  )
}

export const __workflowResult = {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  failedLanes: failures,
  completedLanes,
}
