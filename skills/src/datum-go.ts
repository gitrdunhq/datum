import type { LanePlan, LaneOutcome, SetupResult, LaneResult } from './shared/types'
import { buildWaves, packWaves, parseAgentJson, resolveLanePlanPath, laneSpecHash, epicSlug } from './shared/utils'
import { laneStateReadScript } from './shared/prompts'
import { batchCommandPrompt, parseBatchResult, stepStdout, describeFailure } from './shared/batch'
import { actStartSteps, readLanePlanPrompt } from './shared/lane-steps'
import { model, setModelTiers, PHASES, DEFAULT_CONFIG, type Phase, type Route } from './shared/models'
import { parseState, detectStartFrom, isStaleState, type PipelineState } from './shared/pipeline-state'
import { resolveSkillPath, skillsDirHint, bootPrompt, runCommandPrompt, NO_FINGERPRINT_WARNING } from './shared/boot'
import { stageOpts, configureAgentTypes, readAgentTypeConfig, agentTypeArgs } from './shared/agent-types'

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
// #354: the fingerprint in the prompt is the cache key that lets a resumed
// run notice an edited config. Warn once when the launcher omitted it.
// ('' rather than undefined: esbuild emits `void 0`, which trips the
// build's leaked-TypeScript grep.)
const configFingerprint: string = typeof a.configFingerprint === 'string' ? a.configFingerprint : ''
if (!configFingerprint) log(NO_FINGERPRINT_WARNING)
const bootText = await agent(
  bootPrompt(configFingerprint),
  { label: 'read-config+state', model: model('fast') },
)
const boot = parseAgentJson(bootText as string, { config: {}, state: null, localSkills: [], repoRoot: '', currentBranch: '' }) as {
  config: Record<string, string>; state: unknown; localSkills?: string[]; repoRoot?: string; currentBranch?: string
}
const globalCfg = { ...DEFAULT_CONFIG, ...(boot.config || {}) } as Record<string, any>
// #368: agent_types (default true) / hooks_installed (default false) switches.
// Every child workflow gets them via args — each bundle has its own copy.
configureAgentTypes(readAgentTypeConfig(globalCfg))
log(`Agent types: ${agentTypeArgs().agentTypes ? 'on' : 'off'}, hooks_installed: ${agentTypeArgs().hooksInstalled}`)
// Phase workflows take either the bare 'yolo' string or an object; pass an
// object so the switches ride along with the yolo flag. freeText/issueNumber
// ride along too (#524 dogfooding) — datum-go itself doesn't bootstrap a
// brand-new epic from either one when nothing exists yet (that's a real gap,
// tracked separately), but Refine needs them forwarded at minimum to tell
// the caller their input was received and ignored, rather than throwing a
// generic "TICKET.md not found" with no trace of what was actually passed.
const phaseArgs = {
  yolo,
  agentTypes: agentTypeArgs(),
  freeText: typeof a.freeText === 'string' ? a.freeText : '',
  issueNumber: typeof a.issueNumber === 'number' ? a.issueNumber : null,
}
// Sub-workflow scriptPaths (#353): prefer the repo-local .datum/skills copy
// written by `datum init`; an out-of-repo absolute skills_dir is refused by
// the Workflow harness, so log the fix once instead of dying on a stack trace.
let skillsDirHinted = false
const sk = (name: string): string => {
  const r = resolveSkillPath({
    name,
    skillsDir: globalCfg.skills_dir || '',
    localSkills: boot.localSkills || [],
    repoRoot: boot.repoRoot || '',
  })
  if (r.outsideRepo && !skillsDirHinted) {
    skillsDirHinted = true
    log(skillsDirHint(globalCfg.skills_dir))
  }
  return r.path
}

// Apply model tier overrides from config.json { "models": { "fast": "...", "balanced": "...", "deep": "..." } }
if (globalCfg.models && typeof globalCfg.models === 'object') {
  setModelTiers(globalCfg.models)
  log(`Model tiers: fast=${model('fast')}, balanced=${model('balanced')}, deep=${model('deep')}`)
}

// Preflight: the globally installed `datum` CLI is a `uv tool install --editable`
// pointing at whatever path was on disk the last time it was installed (see
// scripts/preflight-tool-check.sh for the install-metadata inspection). If a
// prior pipeline step ran an install command with cwd
// inside a lane worktree instead of the repo root, that link silently gets
// repointed at a throwaway worktree — every subsequent `datum ...` invocation
// across the whole pipeline then runs a frozen, stale copy of the code with no
// indication anything is wrong (#327). Verify the editable install still
// resolves to this repo root before running anything else, and fail loud
// rather than silently continuing on a stale binary.
//
// This invariant only holds when datum-go is self-hosted (invoked from inside
// the datum repo itself). datum-go is also legitimately used as an external
// orchestrator against a different target repo (#378) — in that case the
// invoking repo's toplevel is the target repo, not datum, and
// scripts/preflight-tool-check.sh (which only ships inside the datum repo)
// won't exist there, so the check is skipped rather than false-positiving on
// an expected mismatch.
//
// The check itself lives in that script file, not an inline one-liner: this
// step runs through an LLM `cli` agent told to execute the command and
// report its stdout, and a long, heavily quote-escaped one-liner proved
// unreliable for the agent to reproduce faithfully (#378 follow-up — a
// semantically-correct inline script still misbehaved when actually run by
// the agent). A short, plain command gives it far less to mangle.
const toolCheckText = await agent(
  runCommandPrompt(
    `SCRIPT="$(git rev-parse --show-toplevel)/scripts/preflight-tool-check.sh" && ` +
    `if [ -f "$SCRIPT" ]; then bash "$SCRIPT"; else ` +
    `echo '{"ok":true,"note":"invoking repo is not the datum repo itself (external orchestration target) — skipping self-hosted install check"}'; fi`,
  ),
  stageOpts('cli', { label: 'preflight-tool-check', model: model('fast') }),
)
const toolCheck = parseAgentJson(toolCheckText as string, { ok: true }) as { ok: boolean; installed?: string; expected?: string; note?: string }
if (!toolCheck.ok) {
  const installedPath = toolCheck.installed ?? '(unknown — preflight check did not return valid JSON, see raw output above)'
  const expectedPath = toolCheck.expected ?? '(unknown — preflight check did not return valid JSON, see raw output above)'
  throw new Error(
    `datum CLI tool install is stale/misdirected (#327): the globally installed editable ` +
    `\`datum\` points at "${installedPath}" but this repo root is "${expectedPath}". ` +
    `Every "datum ..." command this pipeline runs would silently execute code from the wrong ` +
    `location. Fix: run \`uv tool install --editable . --force\` from "${expectedPath}", then re-run.`
  )
}

// Auto-resume: if no explicit startFrom and pipeline-state exists, pick up where we left off
let priorState = parseState(boot.state ? JSON.stringify(boot.state) : null)

// #524 dogfooding: .datum/pipeline-state.json is a single global file, not
// scoped per branch. Leftover state from a prior, unrelated epic must never
// be trusted just because it's still on disk — that silently sent a fresh
// epic straight to Act (startFrom=act from priorState.completedPhases) with
// no TICKET.md/SPEC.md/lane-plan.json ever written for the epic actually on
// this branch, and Act crashed looking for a lane-plan.json that could never
// exist. This check is independent of freeText: a bare `datum go` with no
// brief and stale leftover state deserves the same protection as one with a
// brief that describes different work.
const currentBranch = typeof boot.currentBranch === 'string' ? boot.currentBranch : ''
if (priorState && isStaleState(priorState, currentBranch)) {
  log(`Ignoring pipeline state for branch "${priorState.branch}" — currently checked out on "${currentBranch}". Treating as a fresh run instead of trusting stale completedPhases.`)
  priorState = null
}

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
    stageOpts('cli', { label: `save-state:${p}`, model: model('fast') }),
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
  lastResult = await workflow({ scriptPath: sk('datum-refine') }, phaseArgs) as PhaseResult
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
  lastResult = await workflow({ scriptPath: sk('datum-plan') }, phaseArgs) as PhaseResult
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
  lastResult = await workflow({ scriptPath: sk('datum-properties') }, phaseArgs) as PhaseResult
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
  // guards against unsafe branch state; the same script also stamps this
  // run's runId, resolves lane-plan-final.json over stale lane-plan.json
  // (#232/#237), reads the plan and the epic-scoped completion markers —
  // ONE datum-cli call (#368) where there were four.
  const actStart = actStartSteps({
    branch: 'init',
    initCmd: 'datum init --json',
    lanePlanPath: null,
    laneStateReadScript: laneStateReadScript({
      epicBranch: '$__eb', epicSlug: '', taskIdsSpace: `$(jq -r '.topological_order[]' "$__plan")`,
    }),
  })
  const actStartRaw = await agent(
    batchCommandPrompt(actStart),
    stageOpts('cli', { label: 'act-start', phase: 'Act', model: model('fast') }),
  )
  const actStartResult = parseBatchResult(actStartRaw, actStart)
  const info = parseAgentJson(stepStdout(actStartResult, 'bootstrap') || '', { epicBranch: '' }) as { epicBranch: string; lanePlanPath?: string; adopted?: boolean }
  const epicBranch = info.epicBranch
  const runId = (stepStdout(actStartResult, 'timestamp') || '').trim()
  resolvedBranch = epicBranch
  resolvedRunId = runId
  if (!epicBranch || !runId) throw new Error(`Failed to resolve branch/timestamp via datum init --json: ${JSON.stringify(info)} (${describeFailure(actStartResult, 'act-start')})`)

  // Skeleton dir from Plan phase (pre-generated test contracts)
  const skeletonDir = `docs/epics/${epicBranch}/skeletons`

  // Read lane plan — prefer lane-plan-final.json over stale lane-plan.json
  const epicDir = `docs/epics/${epicBranch}`
  const lanePlanPath = resolveLanePlanPath(epicDir, stepStdout(actStartResult, 'resolve') || '')
  // Read as its own dedicated agent call, not folded into the actStart
  // batch (#524 dogfooding) — a large lane-plan.json embedded in that
  // batch's combined stdout could exceed the harness's inline-output
  // truncation threshold, leaving the truncated agent with no way to
  // relay content it never received.
  const lanePlanText = await agent(
    readLanePlanPrompt(lanePlanPath),
    stageOpts('reader', { label: 'read-lane-plan', phase: 'Act', model: model('fast') }),
  )
  const lanePlan = parseAgentJson<LanePlan | null>(lanePlanText as string, null) as LanePlan
  if (!lanePlan || !lanePlan.lanes) throw new Error(`Failed to parse ${lanePlanPath} — ${describeFailure(actStartResult, 'act-start')}`)

  const waves = buildWaves(lanePlan)
  if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
    throw new Error('Lane plan has 0 tasks — nothing to execute')
  }
  log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`)

  // Epic-scoped completion markers: lanes merged in prior runs/sessions skip entirely.
  // A marker counts only if status=completed, its spec_hash matches the current lane
  // plan entry, and its merge_commit is an ancestor of the epic branch tip.
  const slug = epicSlug(epicBranch)
  const priorMarkers = parseAgentJson(stepStdout(actStartResult, 'lane-state-read') || '', {}) as Record<string, { status: string; spec_hash: string; ancestor: boolean }>
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
      { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, lanePlanPath, batchTag, agentTypes: agentTypeArgs() },
    ) as SetupResult

    // Lane execution — direct child workflow
    const act = await workflow(
      { scriptPath: sk('datum-tdd-act-lane') },
      {
        batchLaneIds: runnableBatchIds, lanePlan, worktreePaths: setup.worktreePaths, batchTag,
        // yolo (#356): lets a blocked GREEN auto-widen allowed_write_files
        // in the lane runner, same as datum-tdd-act passes it.
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, skeletonDir, yolo, agentTypes: agentTypeArgs() },
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

    // Merge + Cleanup — direct child workflow. The epic-scoped completion
    // markers (so future runs/sessions skip these lanes) are written by the
    // merge workflow in the same datum-cli call as the squash merge (#368).
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
        agentTypes: agentTypeArgs(),
        laneState: mergedIds.length > 0
          ? { epicSlug: slug, entries: mergedIds.map(id => ({ task_id: id, spec_hash: laneSpecHash(lanePlan.lanes[id]) })) }
          : null,
      },
    )
  }

  // Docs — direct child workflow
  await workflow(
    { scriptPath: sk('datum-tdd-act-docs') },
    { completedLanes: actCompleted, lanePlan, runId, agentTypes: agentTypeArgs() },
  )

  const actSkipped = Object.keys(actResults).filter(id => actResults[id]?.status === 'skipped')
  const actBlocked = Object.keys(actResults).filter(id => actResults[id]?.status === 'blocked')

  // Triage — direct child workflow
  if (actFailures.length > 0) {
    await workflow(
      { scriptPath: sk('datum-tdd-act-triage') },
      { failures: actFailures, blocked: actBlocked.map(id => actResults[id]), results: actResults, lanePlan, runId, epicBranch, agentTypes: agentTypeArgs() },
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
  lastResult = await workflow({ scriptPath: sk('datum-validate') }, phaseArgs) as PhaseResult
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
  lastResult = await workflow({ scriptPath: sk('datum-review') }, phaseArgs) as PhaseResult
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
  // phaseArgs never carries a runId (Refine/Plan/Properties/Validate/Review
  // don't need one) — Closeout does: without it, datum-closeout.ts's
  // `a.runId || ''` falls back and generates a brand-new, unrelated run id
  // instead of reusing the one Act actually produced (#524 dogfooding).
  lastResult = await workflow({ scriptPath: sk('datum-closeout') }, { ...phaseArgs, runId: resolvedRunId }) as PhaseResult
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
