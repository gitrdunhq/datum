import type { LanePlan, LaneOutcome, SetupResult, LaneResult } from './shared/types'
import { buildWaves, packWaves, parseAgentJson, resolveLanePlanPrompt, resolveLanePlanPath, laneSpecHash, epicSlug } from './shared/utils'
import { laneStateReadPrompt, laneStateWritePrompt } from './shared/prompts'
import { model, setModelTiers, PHASES, READ_CONFIG_PROMPT, DEFAULT_CONFIG, skillPath, type Phase, type Route } from './shared/models'
import { parseState, detectStartFrom, type PipelineState } from './shared/pipeline-state'

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
  try {
    return JSON.parse(raw)
  } catch {
    // Not valid JSON, not "yolo", not a bare issue number. Rather than silently
    // dropping any flags the caller intended (#319 — `--start-from act` was
    // silently discarded, pipeline resumed from stale state and skipped 7
    // bug-fix lanes with no warning), recover the common CLI-style overrides
    // and loudly flag anything we couldn't recover.
    const result: Record<string, unknown> = { yolo: true, freeText: raw }
    const startFromMatch = raw.match(/--start-from[=\s]+(\S+)/)
    const routeMatch = raw.match(/--route[=\s]+(\S+)/)
    if (startFromMatch) result.startFrom = startFromMatch[1]
    if (routeMatch) result.route = routeMatch[1]
    if (!startFromMatch && !routeMatch) {
      log(`WARNING: args "${raw}" is not valid JSON and was not recognized as yolo/#N — all flags in it (startFrom, route, phases) were IGNORED. Pass valid JSON to set these, or use --start-from <phase> / --route <route>.`)
    } else {
      log(`args "${raw}" is not valid JSON — recovered ${startFromMatch ? `startFrom=${startFromMatch[1]} ` : ''}${routeMatch ? `route=${routeMatch[1]}` : ''}from flags. Other fields (e.g. phases) are not supported this way — pass valid JSON to set them.`)
    }
    return result
  }
}
const a = (typeof args === 'string') ? parseArgs(rawArgs) : (args || {})

const yolo: boolean = !!a.yolo
let startFrom = (a.startFrom || 'refine').toLowerCase() as Phase
const explicitStart: boolean = !!a.startFrom
const route = (a.route || 'feature').toLowerCase() as Route
const activePhases: Phase[] = a.phases && a.phases.length > 0
  ? a.phases
  : [...PHASES]

let startIdx = PHASES.indexOf(startFrom)
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
  skipped?: number
  failedLanes?: string[]
  skippedLanes?: string[]
  taskCount?: number
  [key: string]: unknown
}

// Read config + pipeline state in one agent call (single haiku, no routing overhead)
const bootText = await agent(
  `Return a JSON object with two fields:
1. "config": contents of .datum/config.json (or {} if missing)
2. "state": contents of .datum/pipeline-state.json (or null if missing)
Output raw JSON only.`,
  { label: 'read-config+state', model: model('fast') },
)
const boot = parseAgentJson(bootText as string, { config: {}, state: null }) as { config: Record<string, string>; state: unknown }
const globalCfg = { ...DEFAULT_CONFIG, ...(boot.config || {}) } as Record<string, any>
const sk = (name: string) => skillPath(globalCfg.skills_dir || '', name)

// Apply model tier overrides from config.json { "models": { "fast": "...", "balanced": "...", "deep": "..." } }
if (globalCfg.models && typeof globalCfg.models === 'object') {
  setModelTiers(globalCfg.models)
  log(`Model tiers: fast=${model('fast')}, balanced=${model('balanced')}, deep=${model('deep')}`)
}

// Preflight: the globally installed `datum` CLI is a `uv tool install --editable`
// pointing at whatever path was on disk (dist-info/direct_url.json) the last time
// it was installed. If a prior pipeline step ran an install command with cwd
// inside a lane worktree instead of the repo root, that link silently gets
// repointed at a throwaway worktree — every subsequent `datum ...` invocation
// across the whole pipeline then runs a frozen, stale copy of the code with no
// indication anything is wrong (#327). Verify the editable install still
// resolves to this repo root before running anything else, and fail loud
// rather than silently continuing on a stale binary.
const toolCheckText = await agent(
  `REPO_ROOT=$(git rev-parse --show-toplevel) && ` +
  `DIRECT_URL=$(find "$HOME/.local/share/uv/tools/datum" -name direct_url.json 2>/dev/null | head -1) && ` +
  `if [ -z "$DIRECT_URL" ]; then echo '{"ok":true,"note":"no uv tool editable install found, skipping check"}'; exit 0; fi && ` +
  `INSTALLED=$(python3 -c "import json,os,sys; d=json.load(open(sys.argv[1])); print(os.path.realpath(d.get('url','').replace('file://','')))" "$DIRECT_URL") && ` +
  `EXPECTED=$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$REPO_ROOT") && ` +
  `if [ "$INSTALLED" != "$EXPECTED" ]; then echo "{\\"ok\\":false,\\"installed\\":\\"$INSTALLED\\",\\"expected\\":\\"$EXPECTED\\"}"; else echo '{"ok":true}'; fi`,
  { label: 'preflight-tool-check', model: model('fast') },
)
const toolCheck = parseAgentJson(toolCheckText as string, { ok: true }) as { ok: boolean; installed?: string; expected?: string; note?: string }
if (!toolCheck.ok) {
  throw new Error(
    `datum CLI tool install is stale/misdirected (#327): the globally installed editable ` +
    `\`datum\` points at "${toolCheck.installed}" but this repo root is "${toolCheck.expected}". ` +
    `Every "datum ..." command this pipeline runs would silently execute code from the wrong ` +
    `location. Fix: run \`uv tool install --editable . --force\` from "${toolCheck.expected}", then re-run.`
  )
}

// Auto-resume: if no explicit startFrom and pipeline-state exists, pick up where we left off
const priorState = parseState(boot.state ? JSON.stringify(boot.state) : null)

let lastResult: PhaseResult = {}
let haltedAt = ''
let resolvedBranch = priorState?.branch || ''
let resolvedRunId = priorState?.runId || ''
const completedPhases: Phase[] = priorState?.completedPhases ? [...priorState.completedPhases] : []

function shouldRun(p: Phase, idx: number): boolean {
  return !haltedAt && startIdx <= idx && activePhases.includes(p)
}

async function markPhaseComplete(p: Phase, testsPass?: boolean): Promise<void> {
  if (!completedPhases.includes(p)) completedPhases.push(p)
  const testsFlag = p === 'validate' ? (testsPass ? ' --tests-pass' : ' --tests-fail') : ''
  await agent(
    `Run: datum pipeline-state-save --phase "${p}" --run-id "${resolvedRunId}" --route "${route}"${testsFlag}`,
    { label: `save-state:${p}`, model: model('fast') },
  )
}

// New-epic detection (#213 follow-up): a branch can already carry a
// TICKET.md + pipeline-state from a PRIOR epic. Historically the only
// trigger for bootstrapping a new epic was "TICKET.md is entirely
// missing" — if one existed, we silently resumed it, even when the
// caller just typed a free-text brief describing something completely
// different. Reuse the exact CLI bootstrap path Act already uses
// (`datum init --name <slug>`, #213) instead of inventing a second
// mechanism — just trigger it earlier, before auto-resume decides to
// skip straight past Refine.
let newEpicBranch = ''
if (a.freeText && priorState && !explicitStart) {
  const newEpicText = await agent(
    `An existing epic is checked out on this branch. Prior pipeline state: ${JSON.stringify(priorState)}.
Read the current epic's TICKET.md (its branch is "${priorState.branch}"; the file lives at docs/epics/${priorState.branch}/TICKET.md) and compare its title/scope to this NEW brief the caller just typed:
"""
${a.freeText}
"""
Decide: does the brief describe the SAME piece of work as the existing TICKET.md, or a CLEARLY DIFFERENT one?
- If SAME, or you cannot confidently tell they differ: output {"newEpic": false}.
- If CLEARLY DIFFERENT: derive a short kebab-case slug from the brief, then run exactly: datum init --name <slug> --json
  and return the raw JSON it printed, merged with {"newEpic": true, "reason": "<why they differ>"}.
Output ONLY raw JSON, no markdown fences, no explanation.`,
    { label: 'new-epic-check', model: model('balanced') },
  )
  const newEpicInfo = parseAgentJson(newEpicText as string, { newEpic: false }) as { newEpic: boolean; epicBranch?: string; reason?: string }
  if (newEpicInfo.newEpic && newEpicInfo.epicBranch) {
    log(`New epic detected — brief describes different work than the existing TICKET.md on "${priorState.branch}" (${newEpicInfo.reason || 'no reason given'}). Bootstrapped new epic branch: ${newEpicInfo.epicBranch}`)
    newEpicBranch = newEpicInfo.epicBranch
    resolvedBranch = newEpicInfo.epicBranch
  }
}

if (priorState && !explicitStart && !newEpicBranch) {
  const resumeAt = detectStartFrom(priorState)
  if (resumeAt) {
    const resumeIdx = PHASES.indexOf(resumeAt)
    if (resumeIdx > startIdx) {
      log(`Resuming from ${resumeAt} (prior run completed: [${priorState.completedPhases.join(', ')}])`)
      startFrom = resumeAt
      startIdx = resumeIdx
    }
  }
}

log(`datum go — route: ${route}, start: ${startFrom}${yolo ? ' (yolo)' : ''}`)

// Refine
if (shouldRun('refine', 0)) {
  log('── Refine ──')
  lastResult = await workflow({ scriptPath: sk('datum-refine') }, yolo ? 'yolo' : {}) as PhaseResult
  if (!yolo && !lastResult.gatePassed) {
    haltedAt = 'refine'
    log(`Refine gate held: ${lastResult.gateMessage || 'needs review'}. Address QUESTIONS.md, then: datum go --start-from plan`)
  } else {
    log('Refine complete')
    await markPhaseComplete('refine')
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
    await markPhaseComplete('plan')
  }
}

// Properties
if (shouldRun('properties', 2)) {
  log('── Properties ──')
  lastResult = await workflow({ scriptPath: sk('datum-properties') }, yolo ? 'yolo' : {}) as PhaseResult
  log('Properties complete')
  await markPhaseComplete('properties')
}

// Act — inlined from datum-tdd-act to avoid workflow() nesting limit
// (datum-tdd-act calls setup/lane/merge/docs/triage as child workflows;
//  if datum-go also called datum-tdd-act as a child, that would be 2 levels deep)
log(`[debug] shouldRun act=${shouldRun('act', 3)} startIdx=${startIdx} haltedAt=${haltedAt} activePhases=${JSON.stringify(activePhases)}`)

if (shouldRun('act', 3)) {
  log('── Act ──')

  const testCommand = globalCfg.test_command || DEFAULT_CONFIG.test_command
  const language = globalCfg.language || DEFAULT_CONFIG.language

  // Bootstrap: resolve branch + generate runId via the CLI adopt path
  // (`datum init --json`, #213) instead of an inline-only agent prompt.
  // The CLI detects/adopts an existing feature branch (epicBranch) and
  // guards against unsafe branch state; we still ask the agent for a
  // fresh timestamp to use as this run's runId.
  const bootstrapInfo = await agent(
    `Run this EXACT command and capture its raw stdout: datum init --json
Then run: date +%Y%m%d-%H%M%S
Return ONLY a single JSON object merging the fields from the datum init --json output (epicBranch, lanePlanPath, adopted) plus a "timestamp" field set to the date command's output. No markdown fences, no explanation.`,
    { label: 'act-bootstrap', model: model('fast') },
  )
  const info = parseAgentJson(bootstrapInfo, { epicBranch: '', timestamp: '' }) as { epicBranch: string; timestamp: string; lanePlanPath?: string; adopted?: boolean }
  const epicBranch = info.epicBranch
  const runId = info.timestamp
  resolvedBranch = epicBranch
  resolvedRunId = runId
  if (!epicBranch || !runId) throw new Error(`Failed to resolve branch/timestamp via datum init --json: ${JSON.stringify(info)}`)

  // Skeleton dir from Plan phase (pre-generated test contracts)
  const skeletonDir = `docs/epics/${epicBranch}/skeletons`

  // Read lane plan — prefer lane-plan-final.json over stale lane-plan.json
  const epicDir = `docs/epics/${epicBranch}`
  const resolveText = await agent(
    resolveLanePlanPrompt(epicDir),
    { label: 'resolve-lane-plan', phase: 'Act', model: model('fast') }
  )
  const lanePlanPath = resolveLanePlanPath(epicDir, resolveText)
  const planText = await agent(
    `Read ${lanePlanPath} and return its contents as raw JSON text. Output ONLY the JSON, no markdown fences, no explanation.`,
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

  // Epic-scoped completion markers: lanes merged in prior runs/sessions skip entirely.
  // A marker counts only if status=completed, its spec_hash matches the current lane
  // plan entry, and its merge_commit is an ancestor of the epic branch tip.
  const slug = epicSlug(epicBranch)
  const markerText = await agent(
    laneStateReadPrompt({ epicBranch, epicSlug: slug, taskIdsSpace: lanePlan.topological_order.join(' ') }),
    { label: 'lane-state-read', phase: 'Act', model: model('fast') },
  )
  const priorMarkers = parseAgentJson(markerText, {}) as Record<string, { status: string; spec_hash: string; ancestor: boolean }>
  const alreadyMerged = lanePlan.topological_order.filter((id: string) => {
    const m = priorMarkers[id]
    return !!m && m.status === 'completed' && m.ancestor === true && m.spec_hash === laneSpecHash(lanePlan.lanes[id] || {})
  })

  const actResults: Record<string, LaneOutcome> = {}
  const actFailures: string[] = []
  const actCompleted: string[] = []
  for (const id of alreadyMerged) {
    actResults[id] = { task_id: id, status: 'completed' }
    actCompleted.push(id)
  }
  if (alreadyMerged.length > 0) {
    log(`Epic-scoped state: ${alreadyMerged.length} lane(s) already merged, skipping: [${alreadyMerged.join(', ')}]`)
  }

  // Batch partitioning
  const MAX_BATCH = 5
  const allLaneIds = lanePlan.topological_order.filter((id: string) => !alreadyMerged.includes(id))
  const remainingWaves = waves
    .map((wave) => wave.filter((id) => allLaneIds.includes(id)))
    .filter((wave) => wave.length > 0)
  const batches: string[][] = packWaves(remainingWaves, MAX_BATCH, lanePlan)
  log(`Wave-packed ${allLaneIds.length} tasks into ${batches.length} batches`)
  if (batches.length > 1) {
    log(`Auto-partitioned ${allLaneIds.length} tasks into ${batches.length} batches`)
  }

  // Batch loop — each sub-workflow is a DIRECT child of datum-go (1 level, not 2)
  for (let bi = 0; bi < batches.length; bi++) {
    const batchLaneIds = batches[bi]
    const batchTag = batches.length > 1 ? ` [batch ${bi + 1}/${batches.length}]` : ''
    const batchRunId = batches.length > 1 ? `${runId}-b${bi}` : runId

    if (batches.length > 1) log(`\n=== Batch ${bi + 1}/${batches.length}: [${batchLaneIds.join(', ')}] ===`)

    // Cross-batch dependency check: block lanes whose deps failed/were blocked,
    // skip lanes whose deps never ran. Failed deps are NOT satisfied deps.
    for (const lid of batchLaneIds) {
      const deps: string[] = lanePlan.lanes[lid]?.depends_on || []
      const unmet = deps.filter((d: string) => !batchLaneIds.includes(d) && !actCompleted.includes(d))
      if (unmet.length === 0) continue
      const failedDeps = unmet.filter((d: string) => actFailures.includes(d) || actResults[d]?.status === 'blocked')
      const neverRan = unmet.filter((d: string) => !failedDeps.includes(d))
      const rootCauses = failedDeps.map((d: string) => `${d}@${actResults[d]?.stage || '?'}`)
      const detail = [
        rootCauses.length > 0 ? `dep(s) failed/blocked: [${rootCauses.join(', ')}]` : '',
        neverRan.length > 0 ? `dep(s) never ran: [${neverRan.join(', ')}]` : '',
      ].filter(Boolean).join('; ')
      actResults[lid] = { task_id: lid, status: 'blocked', stage: 'SKIPPED', error: `blocked — ${detail}` }
      log(`  BLOCKED ${lid}: ${detail}`)
    }
    const runnableBatchIds = batchLaneIds.filter((id: string) => !actResults[id])
    if (runnableBatchIds.length === 0) {
      log(`Batch ${bi} fully skipped — all lanes have unmet deps`)
      continue
    }

    // Setup — direct child workflow
    const setup = await workflow(
      { scriptPath: sk('datum-tdd-act-setup') },
      { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, lanePlanPath, batchTag },
    ) as SetupResult

    // Lane execution — direct child workflow
    const act = await workflow(
      { scriptPath: sk('datum-tdd-act-lane') },
      {
        batchLaneIds: runnableBatchIds, lanePlan, worktreePaths: setup.worktreePaths, batchTag,
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, skeletonDir },
        priorFailures: actFailures,
        priorCompleted: actCompleted,
      },
    ) as LaneResult

    // Collect results
    for (const [id, r] of Object.entries(act.results || {})) {
      actResults[id] = r
      if (!r || r.status === 'failed') {
        actFailures.push(id)
        log(`  FAILED ${id}: ${r ? `${r.stage} — ${r.error}` : 'null result'}`)
      } else if (r.status === 'skipped' || r.status === 'blocked') {
        log(`  ${r.status.toUpperCase()} ${id}: ${r.error || 'dependency failed'}`)
      } else {
        actCompleted.push(id)
      }
    }
    log(`Act${batchTag} done: ${batchLaneIds.filter(id => actCompleted.includes(id)).length}/${batchLaneIds.length} succeeded`)

    // Merge + Cleanup — direct child workflow
    const mergedIds = batchLaneIds.filter(id => actCompleted.includes(id))
    await workflow(
      { scriptPath: sk('datum-tdd-act-merge') },
      {
        epicBranch,
        completedIds: mergedIds,
        results: actResults,
        batchRunId,
        topoOrder: lanePlan.topological_order,
        batchTag,
      },
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

  // Docs — direct child workflow
  await workflow(
    { scriptPath: sk('datum-tdd-act-docs') },
    { completedLanes: actCompleted, lanePlan, runId },
  )

  const actSkipped = Object.keys(actResults).filter(id => actResults[id]?.status === 'skipped')
  const actBlocked = Object.keys(actResults).filter(id => actResults[id]?.status === 'blocked')

  // Triage — direct child workflow
  if (actFailures.length > 0) {
    await workflow(
      { scriptPath: sk('datum-tdd-act-triage') },
      { failures: actFailures, blocked: actBlocked.map(id => actResults[id]), results: actResults, lanePlan, runId, epicBranch },
    )
  }

  await markPhaseComplete('act')
  log(`Act complete — ${actCompleted.length}/${lanePlan.total_lanes} succeeded, ${actFailures.length} failed, ${actSkipped.length} skipped, ${actBlocked.length} blocked`)
  lastResult = { completed: actCompleted.length, failed: actFailures.length, skipped: actSkipped.length, blocked: actBlocked.length, failedLanes: actFailures, skippedLanes: actSkipped, blockedLanes: actBlocked }

  // A run where nothing landed must not fall through to validate/review/closeout —
  // those phases would otherwise report/mark success for an epic that shipped no
  // code, even in yolo mode where the per-phase gates above are bypassed.
  if (actCompleted.length === 0 && lanePlan.total_lanes > 0) {
    haltedAt = 'act'
    log(`Act produced 0/${lanePlan.total_lanes} completed lanes — halting before validate/review/closeout to avoid reporting false completion.`)
  }
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
    await markPhaseComplete('validate', !!lastResult.testsPassed)
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
    await markPhaseComplete('review')
  }
}

// Closeout
if (shouldRun('closeout', 6)) {
  log('── Closeout ──')
  lastResult = await workflow({ scriptPath: sk('datum-closeout') }, yolo ? 'yolo' : {}) as PhaseResult
  log('Closeout complete')
  await markPhaseComplete('closeout')
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
