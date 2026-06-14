import type { LanePlan, LaneOutcome, SetupResult, LaneResult } from './shared/types'
import { buildWaves, parseAgentJson } from './shared/utils'
import { model, PHASES, READ_CONFIG_PROMPT, DEFAULT_CONFIG, skillPath, type Phase, type Route } from './shared/models'
import detectBranchPrompt from './prompts/util-detect-branch.md'

export const meta = {
  name: 'datum-go',
  description: 'Full pipeline: TICKET → SPEC → Plan → Properties → Act → Validate → Review → Closeout',
  phases: [],
}

// ── Parse args ──

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
function parseArgs(raw: string): Record<string, unknown> {
  if (!raw || raw.toLowerCase() === 'yolo') return { yolo: true }
  if (/^#?\d+$/.test(raw)) return { yolo: true, issueNumber: parseInt(raw.replace('#', ''), 10) }
  try { return JSON.parse(raw) } catch {
    return { yolo: true, freeText: raw }
  }
}
const a = (typeof args === 'string') ? parseArgs(rawArgs) : (args || {})

const yolo: boolean = !!a.yolo
const startFrom = (a.startFrom || 'refine').toLowerCase() as Phase
const route = (a.route || 'feature').toLowerCase() as Route
const activePhases: Phase[] = a.phases && a.phases.length > 0
  ? a.phases
  : [...PHASES]

const startIdx = PHASES.indexOf(startFrom)
if (startIdx === -1) {
  throw new Error(`Unknown phase: ${startFrom}. Valid: ${PHASES.join(', ')}`)
}

// ── Pipeline ──

interface PhaseResult {
  gatePassed?: boolean
  gateMessage?: string
  testsPassed?: boolean
  criticalFindings?: number
  canMerge?: boolean
  completed?: number
  failed?: number
  failedLanes?: string[]
  taskCount?: number
  [key: string]: unknown
}

let lastResult: PhaseResult = {}
let haltedAt = ''

function shouldRun(p: Phase, idx: number): boolean {
  return !haltedAt && startIdx <= idx && activePhases.includes(p)
}

log(`datum go — route: ${route}, start: ${startFrom}${yolo ? ' (yolo)' : ''}`)

// Read config early — needed for skillPath resolution across all phases
const cfgTextEarly = await agent(READ_CONFIG_PROMPT, { label: 'read-config', model: model('fast') })
const globalCfg = parseAgentJson(cfgTextEarly, { ...DEFAULT_CONFIG }) as Record<string, string>
const sk = (name: string) => skillPath(globalCfg.skills_dir || '', name)

// Refine
if (shouldRun('refine', 0)) {
  log('── Refine ──')
  lastResult = await workflow({ scriptPath: sk('datum-refine') }, yolo ? 'yolo' : {}) as PhaseResult
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = 'refine'
    log(`Refine gate held: ${lastResult.gateMessage || 'needs review'}. Address QUESTIONS.md, then: datum go --start-from plan`)
  } else {
    log('Refine complete')
  }
}

// Plan
if (shouldRun('plan', 1)) {
  log('── Plan ──')
  lastResult = await workflow({ scriptPath: sk('datum-plan') }, yolo ? 'yolo' : {}) as PhaseResult
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = 'plan'
    log(`Plan gate held: ${lastResult.gateMessage || 'needs approval'}. Review TASKS.md, then: datum go --start-from properties`)
  } else {
    log(`Plan complete — ${lastResult.taskCount || '?'} tasks`)
  }
}

// Properties
if (shouldRun('properties', 2)) {
  log('── Properties ──')
  lastResult = await workflow({ scriptPath: sk('datum-properties') }, yolo ? 'yolo' : {}) as PhaseResult
  log('Properties complete')
}

// Act — inlined from datum-tdd-act to avoid workflow() nesting limit
// (datum-tdd-act calls setup/lane/merge/docs/triage as child workflows;
//  if datum-go also called datum-tdd-act as a child, that would be 2 levels deep)
log(`[debug] shouldRun act=${shouldRun('act', 3)} startIdx=${startIdx} haltedAt=${haltedAt} activePhases=${JSON.stringify(activePhases)}`)

if (shouldRun('act', 3)) {
  log('── Act ──')

  const testCommand = globalCfg.test_command || DEFAULT_CONFIG.test_command
  const language = globalCfg.language || DEFAULT_CONFIG.language

  // Detect branch + generate runId
  const branchInfo = await agent(detectBranchPrompt, { label: 'act-detect', model: model('fast') })
  const info = parseAgentJson(branchInfo, { branch: '', timestamp: '' }) as { branch: string; timestamp: string }
  const epicBranch = info.branch
  const runId = info.timestamp
  if (!epicBranch || !runId) throw new Error(`Failed to detect branch/timestamp: ${JSON.stringify(info)}`)

  // Read lane plan from epic dir (never root)
  const lanePlanPath = `docs/epics/${epicBranch}/lane-plan.json`
  const planText = await agent(
    `Read ${lanePlanPath} and return its contents as raw JSON text. If not found, try .datum/lane-plan.json as fallback. Output ONLY the JSON, no markdown fences, no explanation.`,
    { label: 'read-plan', model: model('fast') },
  )
  const lanePlan = (typeof planText === 'string'
    ? parseAgentJson<LanePlan | null>(planText, null)
    : planText) as LanePlan
  if (!lanePlan || !lanePlan.lanes) throw new Error('Failed to parse lane-plan.json — agent returned unparseable output')

  const waves = buildWaves(lanePlan)
  if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
    throw new Error('Lane plan has 0 tasks — nothing to execute')
  }
  log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`)

  // Batch partitioning
  const MAX_BATCH = 5
  const allLaneIds = lanePlan.topological_order
  const batches: string[][] = []
  for (let i = 0; i < allLaneIds.length; i += MAX_BATCH) {
    batches.push(allLaneIds.slice(i, i + MAX_BATCH))
  }
  if (batches.length > 1) {
    log(`Auto-partitioned ${lanePlan.total_lanes} tasks into ${batches.length} batches`)
  }

  // Batch loop — each sub-workflow is a DIRECT child of datum-go (1 level, not 2)
  const actResults: Record<string, LaneOutcome> = {}
  const actFailures: string[] = []
  const actCompleted: string[] = []

  for (let bi = 0; bi < batches.length; bi++) {
    const batchLaneIds = batches[bi]
    const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : ''
    const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId

    if (batches.length > 1) log(`\n=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(', ')}] ===`)

    // Setup — direct child workflow
    const setup = await workflow(
      { scriptPath: sk('datum-tdd-act-setup') },
      { batchRunId, epicBranch, batchLaneIds, lanePlan, batchTag },
    ) as SetupResult

    // Lane execution — direct child workflow
    const act = await workflow(
      { scriptPath: sk('datum-tdd-act-lane') },
      {
        batchLaneIds, lanePlan, worktreePaths: setup.worktreePaths, batchTag,
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language },
        priorFailures: actFailures,
      },
    ) as LaneResult

    // Collect results
    for (const [id, r] of Object.entries(act.results || {})) {
      actResults[id] = r
      if (!r || r.status !== 'completed') {
        actFailures.push(id)
        log(`  FAILED ${id}: ${r ? `${r.stage} — ${r.error}` : 'null result'}`)
      } else {
        actCompleted.push(id)
      }
    }
    log(`Act${batchTag} done: ${batchLaneIds.filter(id => actCompleted.includes(id)).length}/${batchLaneIds.length} succeeded`)

    // Merge + Cleanup — direct child workflow
    await workflow(
      { scriptPath: sk('datum-tdd-act-merge') },
      {
        epicBranch,
        completedIds: batchLaneIds.filter(id => actCompleted.includes(id)),
        batchRunId,
        topoOrder: lanePlan.topological_order,
        batchTag,
      },
    )
  }

  // Docs — direct child workflow
  await workflow(
    { scriptPath: sk('datum-tdd-act-docs') },
    { completedLanes: actCompleted, lanePlan, runId },
  )

  // Triage — direct child workflow
  if (actFailures.length > 0) {
    await workflow(
      { scriptPath: sk('datum-tdd-act-triage') },
      { failures: actFailures, results: actResults, lanePlan, runId, epicBranch },
    )
  }

  log(`Act complete — ${actCompleted.length}/${lanePlan.total_lanes} succeeded, ${actFailures.length} failed`)
  lastResult = { completed: actCompleted.length, failed: actFailures.length, failedLanes: actFailures }
} else if (activePhases.includes('act' as Phase)) {
  log(`[warn] Act phase was in activePhases but shouldRun returned false — startIdx=${startIdx} haltedAt=${haltedAt}`)
}

// Validate
if (shouldRun('validate', 4)) {
  log('── Validate ──')
  lastResult = await workflow({ scriptPath: sk('datum-validate') }, yolo ? 'yolo' : {}) as PhaseResult
  if (!yolo && !lastResult.testsPassed) {
    haltedAt = 'validate'
    log('Validate FAILED — tests are red. Pipeline halted.')
  } else {
    log('Validate complete')
  }
}

// Review
if (shouldRun('review', 5)) {
  log('── Review ──')
  lastResult = await workflow({ scriptPath: sk('datum-review') }, yolo ? 'yolo' : {}) as PhaseResult
  if (!yolo && !lastResult.canMerge) {
    haltedAt = 'review'
    log(`Review: ${lastResult.criticalFindings || '?'} critical issues. Fix, then: datum go --start-from validate`)
  } else {
    log('Review complete — clear to merge')
  }
}

// Closeout
if (shouldRun('closeout', 6)) {
  log('── Closeout ──')
  lastResult = await workflow({ scriptPath: sk('datum-closeout') }, yolo ? 'yolo' : {}) as PhaseResult
  log('Closeout complete')
}

if (haltedAt) {
  log(`\nPipeline halted at ${haltedAt}. Resume with: datum go --start-from <next-phase>`)
} else {
  log('\n' + '='.repeat(60))
  log('DATUM GO COMPLETE')
  log('='.repeat(60))
}

export const __workflowResult = {
  phase: haltedAt || 'complete',
  halted: !!haltedAt,
  ...lastResult,
}
