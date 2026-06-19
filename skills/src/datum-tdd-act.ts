import { model, setModelTiers } from './shared/models'
import type { LanePlan, LaneOutcome, SetupResult, LaneResult } from './shared/types'
import { buildWaves, parseAgentJson, resolveLanePlanPrompt, resolveLanePlanPath } from './shared/utils'
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

// ── Resume support (#194): detect existing worktrees and completed lanes ──
const resume: boolean = !!a.resume

// Detect completed lanes from existing worktree branches (#194)
let resumedCompleted: string[] = []
if (resume) {
  log('Resume mode: detecting completed lanes from existing branches')
  const branchCheck = await agent(
    `For each lane task in topological order, check if its branch is already completed.
Run these commands for each lane ID in: ${allLaneIds.join(', ')}
  git branch --list "datum/${epicBranch}--${"TASK_ID"}" 2>/dev/null | head -1
  If the branch exists, check: git log --oneline "datum/${epicBranch}--TASK_ID" 2>/dev/null | head -3
  A lane is "completed" if its branch has a commit matching "refactor(TASK_ID):" or "done" in the message.
  Return JSON: {"completed": ["lane-id-1", "lane-id-2"], "existing_branches": ["lane-id-1", ...]}
No markdown fences, no explanation.`,
    { label: 'resume-detect', model: model('fast') }
  )
  if (branchCheck) {
    const detected = typeof branchCheck === 'string'
      ? parseAgentJson(branchCheck, { completed: [], existing_branches: [] })
      : branchCheck
    resumedCompleted = detected.completed || []
    log(`  Resumed: ${resumedCompleted.length} lanes already completed`)
  }
}

// Write resolved lane plan to .datum/ for setup phase (#237 version drift fix)
const datumLanePlanPath = '.datum/lane-plan.json'
const datumLanePlanDir = datumLanePlanPath.split('/').slice(0, -1).join('/')
await agent(
  `mkdir -p ./${datumLanePlanDir} && printf '%s' '${JSON.stringify(lanePlan).replace(/'/g, "'\\''")}' > "${datumLanePlanPath}"`,
  { label: 'write-lane-plan', phase: 'Topology', model: model('fast') }
)


// ── Batch loop ──

const results: Record<string, LaneOutcome> = {}
const failures: string[] = []
const completedLanes: string[] = []

for (let bi = 0; bi < batches.length; bi++) {
  const batchLaneIds = batches[bi]
  const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : ''
  const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId

  if (batches.length > 1) log(`\n${'='.repeat(60)}\n=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(', ')}] ===\n${'='.repeat(60)}`)

  // Cross-batch dependency check: skip lanes whose deps never ran
  for (const lid of batchLaneIds) {
    const deps: string[] = lanePlan.lanes[lid]?.depends_on || []
    const missing = deps.filter((d: string) => !batchLaneIds.includes(d) && !completedLanes.includes(d) && !failures.includes(d))
    if (missing.length > 0) {
      results[lid] = { task_id: lid, status: 'skipped', stage: 'SKIPPED', error: `unmet cross-batch deps: [${missing.join(', ')}]` }
      log(`  SKIPPED ${lid}: deps [${missing.join(', ')}] never ran`)
    }
  }
  // Skip lanes already completed in a prior run (#194 resume)
  const resumedBatchIds = batchLaneIds.filter((id: string) => resumedCompleted.includes(id))
  for (const lid of resumedBatchIds) {
    results[lid] = { task_id: lid, status: 'completed' }
    if (!completedLanes.includes(lid)) completedLanes.push(lid)
    log(`  RESUMED ${lid}: lane already completed in prior run`)
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
    { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, batchTag, resume }
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
    } else if (r.status === 'skipped') {
      log(`  SKIPPED ${id}: ${r.error || 'dependency failed'}`)
    } else {
      completedLanes.push(id)
    }
  }
  log(`Act${batchTag} done: ${batchLaneIds.filter(id => completedLanes.includes(id)).length}/${batchLaneIds.length} succeeded`)

  // Merge + Cleanup
  log('── Merge ──')
  await workflow(
    { scriptPath: sk('datum-tdd-act-merge') },
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

log('── Docs ──')
await workflow(
  { scriptPath: sk('datum-tdd-act-docs') },
  { completedLanes, lanePlan, runId }
)

// ── Summary ──

const skippedLanes = Object.keys(results).filter(id => results[id]?.status === 'skipped')

log(`\n${'═'.repeat(60)}`)
log(`ACT COMPLETE: ${completedLanes.length}/${lanePlan.total_lanes} succeeded, ${failures.length} failed, ${skippedLanes.length} skipped`)
if (completedLanes.length > 0) log(`  completed: [${completedLanes.join(', ')}]`)
if (failures.length > 0) {
  log(`  failed:    [${failures.join(', ')}]`)
  for (const fid of failures) {
    const r = results[fid]
    if (r) log(`    ${fid}: ${r.stage} — ${r.error}`)
  }
}
if (skippedLanes.length > 0) log(`  skipped:   [${skippedLanes.join(', ')}]`)
log(`${'═'.repeat(60)}`)

// ── Triage ──

if (failures.length > 0) {
  log('── Triage ──')
  await workflow(
    { scriptPath: sk('datum-tdd-act-triage') },
    { failures, results, lanePlan, runId, epicBranch }
  )
}

export const __workflowResult = {
  runId,
  total: lanePlan.total_lanes,
  completed: completedLanes.length,
  failed: failures.length,
  skipped: skippedLanes.length,
  failedLanes: failures,
  skippedLanes,
  completedLanes,
}
