import type { LanePlanDigest, LaneOutcome, SetupResult, LaneResult, MergeResult, DocsResult, GoArgs, RepoConfig } from './shared/types'
import { buildWaves, packWaves, parseAgentJson, parseAgentJsonStrict, resolveLanePlanPath, epicSlug } from './shared/utils'
import { laneStateReadScript } from './shared/prompts'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout, describeFailure, type BatchResult } from './shared/batch'
import { actStartSteps, lanePlanDigestFromSteps, digestSpecHash, cleanupSteps } from './shared/lane-steps'
import { runBatch } from './shared/agents'
import { model, setModelTiers, PHASES, DEFAULT_CONFIG, type Phase, type Route } from './shared/models'
import { parseState, detectStartFrom, isStaleState, pipelineStateSaveSteps, pipelineStateSaveFromSteps, type PipelineState } from './shared/pipeline-state'
import { resolveSkillPath, skillsDirHint, bootSteps, bootFromSteps, runCommandPrompt, NO_FINGERPRINT_WARNING, newEpicBootstrapSteps, newEpicBootstrapFromSteps } from './shared/boot'
import { stageOpts, bootstrapOpts, configureAgentTypes, readAgentTypeConfig, agentTypeArgs } from './shared/agent-types'

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
const a = ((typeof args === 'string') ? parseArgs(rawArgs) : (args || {})) as GoArgs

const yolo: boolean = !!a.yolo
let startFrom = (a.startFrom || 'refine').toLowerCase() as Phase
const explicitStart: boolean = !!a.startFrom
const route = (a.route || 'feature').toLowerCase() as Route
// Validated: a typo or case mismatch used to drop the phase silently and
// the pipeline continued as if it had run (phase review wf_9a69f891-462).
const activePhases: Phase[] = a.phases && a.phases.length > 0
  ? a.phases.map((p) => String(p).toLowerCase()).map((p) => {
      if (!(PHASES as string[]).includes(p)) throw new Error(`invalid_phase: ${JSON.stringify(p)} is not a phase. Valid: ${PHASES.join(', ')}`)
      return p as Phase
    })
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

// Deterministic config + pipeline-state read: one datum-cli batch (cat both
// config files, pipeline state, list .datum/skills, resolve repo root +
// branch) instead of an LLM relay asked to read/merge/echo those facts back
// (#368 follow-up; mirrors the datum-plan.ts config-batch conversion,
// commit a7093d2). ('' rather than undefined: esbuild emits `void 0`, which
// trips the build's leaked-TypeScript grep.)
// #354: the boot batch below is an agent() call like any other, so on
// `Workflow({resumeFromRunId})` it replays from cache unless its prompt
// changed. configFingerprint (`datum config-fingerprint`: config + epic
// docs + pipeline state) is stamped into EVERY batch prompt of this run and
// of every child, so a human edit between runs — an answered QUESTIONS.md,
// a fixed SPEC.md — re-runs the deterministic layer and the gates instead
// of replaying the stale verdict. Unset means the launcher isn't wiring it.
const configFingerprint: string = typeof a.configFingerprint === 'string' ? a.configFingerprint : ''
if (!configFingerprint) log(NO_FINGERPRINT_WARNING)
setBatchCacheKey(configFingerprint)
const bootBatch = parseBatchResult(
  // bootstrapOpts: the switches live in the config this very read fetches.
  await agent(batchCommandPrompt(bootSteps()), bootstrapOpts('cli', { label: 'boot', model: model('fast') })),
  bootSteps(),
)
if (bootBatch.missing) throw new Error(describeFailure(bootBatch, 'boot'))
const boot = bootFromSteps(bootBatch)
const globalCfg = { ...DEFAULT_CONFIG, ...(boot.config || {}) } as RepoConfig
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
  configFingerprint,
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
    log(skillsDirHint(globalCfg.skills_dir || ''))
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
// Strict: {ok:true} would silently treat a garbled/missing preflight
// response as "the stale-binary check passed" — the exact failure mode this
// preflight exists to catch (#327) — so an unparseable result must throw,
// not default to ok:true.
const toolCheck = parseAgentJsonStrict(toolCheckText as string, 'preflight-tool-check') as { ok: boolean; installed?: string; expected?: string; note?: string }
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

// Preflight: demand a robust .gitignore. Every scratch path datum writes
// (.datum/worktrees, .datum/runs, .datum/skills, .datum/hooks, .temp) must
// be ignored, or generated files end up in `git add .`, collide with lane
// squash-merges and get blamed on agents. yolo auto-fixes (append-only,
// idempotent); otherwise halt with the exact gaps before any agent burns
// tokens on a run that would fail at merge time.
const gitignoreText = await agent(
  runCommandPrompt(`datum gitignore-check${yolo ? ' --fix' : ''}`),
  stageOpts('cli', { label: 'preflight-gitignore', model: model('fast') }),
)
// Strict: {ok:true} would silently treat a garbled/missing gitignore-check
// response as "the scratch-path guard passed", letting generated files land
// in `git add .` undetected — an unparseable result must throw, not default
// to ok:true.
const gitignoreCheck = parseAgentJsonStrict(gitignoreText as string, 'preflight-gitignore') as { ok: boolean; missing: string[]; added: string[] }
if (gitignoreCheck.added?.length) {
  log(`[preflight] .gitignore was missing datum scratch paths — appended (yolo): ${gitignoreCheck.added.join(', ')}`)
}
if (!gitignoreCheck.ok) {
  throw new Error(
    `.gitignore does not ignore datum's scratch paths — missing: ${(gitignoreCheck.missing || []).join(', ')}. ` +
    `Generated files under those paths would land in \`git add .\` and collide with lane squash-merges. ` +
    `Fix: run \`datum gitignore-check --fix\` (or re-run with yolo, which appends them automatically), then re-run.`
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
  // pipeline-state-save verifies the phase against git/filesystem evidence
  // and refuses (verified:false, exit 1) when it finds none. Believe the
  // CLI, not our own bookkeeping — and read the CLI from a batch step's
  // exit code + JSON (shared/pipeline-state.ts), not from an LLM runner's
  // echo: a runner that returned nothing, or paraphrased the refusal, used
  // to be taken as "recorded" while nothing was written on disk. Neither a
  // refusal nor an unverified save records the phase in memory, so a resume
  // re-runs the phase rather than skipping it on a claim.
  const saveSteps = pipelineStateSaveSteps({ phase: p, runId: resolvedRunId, route, testsPass })
  const saved = pipelineStateSaveFromSteps(parseBatchResult(
    await agent(batchCommandPrompt(saveSteps), stageOpts('cli', { label: `save-state:${p}`, model: model('fast') })),
    saveSteps,
  ), p)
  if (!saved.recorded) {
    log(`[warn] ${saved.reason} — phase "${p}" NOT recorded in .datum/pipeline-state.json`)
    return
  }
  if (!completedPhases.includes(p)) completedPhases.push(p)
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
- If CLEARLY DIFFERENT: derive a short kebab-case slug from the brief and output {"newEpic": true, "slug": "<kebab-case-slug>", "reason": "<why they differ>"}.
Do NOT run datum init or any other command — the workflow bootstraps the new epic itself from your slug.
Output ONLY raw JSON, no markdown fences, no explanation.`,
    { label: 'new-epic-check', model: model('balanced') },
  )
  // Safe: {newEpic:false} is the prompt's own contracted answer for "SAME, or
  // you cannot confidently tell they differ" — an unparseable response is
  // exactly that "cannot confidently tell" case, so falling back here
  // withholds the extra new-epic bootstrap rather than enabling a check
  // skip; it never fires a spurious bootstrap since that also requires a
  // valid slug below.
  const newEpicInfo = parseAgentJson(newEpicText as string, { newEpic: false }) as { newEpic: boolean; slug?: string; reason?: string }
  if (newEpicInfo.newEpic && typeof newEpicInfo.slug === 'string' && newEpicInfo.slug.trim()) {
    // The model only decided; the bootstrap is a batch step running
    // `datum init --name <slug> --json` (shared/boot.ts) whose stdout the
    // script parses — a runner-echoed epicBranch used to become
    // resolvedBranch with nothing verifying that the init actually ran.
    const bootstrapSteps = newEpicBootstrapSteps(newEpicInfo.slug)
    const bootstrap = newEpicBootstrapFromSteps(parseBatchResult(
      await agent(batchCommandPrompt(bootstrapSteps), stageOpts('cli', { label: 'new-epic-bootstrap', model: model('fast') })),
      bootstrapSteps,
    ), newEpicInfo.slug)
    if (!bootstrap.ok) throw new Error(`new_epic_bootstrap_failed: ${bootstrap.error}`)
    log(`New epic detected — brief describes different work than the existing TICKET.md on "${priorState.branch}" (${newEpicInfo.reason || 'no reason given'}). Bootstrapped new epic branch: ${bootstrap.epicBranch}`)
    newEpicBranch = bootstrap.epicBranch
    resolvedBranch = bootstrap.epicBranch
    // The prior epic's run id must not leak into this epic's closeout when
    // Act is not in activePhases (phase review wf_9a69f891-462); '' makes
    // the closeout phase mint its own.
    resolvedRunId = ''
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

// A thrown child workflow (e.g. a parseAgentJsonStrict failure from an
// unparseable agent response) must not crash datum-go with no halt record
// and no summary — that's the exact regression already hit once for the
// docs child (wf_b1c88e09-036, see the try/catch further down). Fold it
// into the existing gate-halt path instead: the phase is recorded as failed
// (gatePassed: false, gateMessage: the thrown message) and a resume
// re-enters it, same as a real gate failure would.
async function runPhaseWorkflow(scriptPath: string, args: unknown, phaseName: string): Promise<PhaseResult> {
  try {
    return await workflow({ scriptPath }, args) as PhaseResult
  } catch (exc) {
    const message = (exc as Error).message
    log(`[warn] ${phaseName}_workflow_failed: ${message}`)
    return { gatePassed: false, gateMessage: message }
  }
}

// Refine
if (shouldRun('refine', 0)) {
  log('── Refine ──')
  lastResult = await runPhaseWorkflow(sk('datum-refine'), phaseArgs, 'refine')
  // yolo already passes --approve (skips only the human hold); a gate that
  // still fails is a real structural failure and halts in every mode.
  if (!lastResult.gatePassed) {
    haltedAt = 'refine'
    log(`Refine gate ${lastResult.gateNeedsHuman ? 'held' : 'FAILED'}: ${lastResult.gateMessage || 'needs review'}. Address QUESTIONS.md, then: datum go --start-from plan`)
  } else {
    log('Refine complete')
    await markPhaseComplete('refine')
  }
}

// Plan
if (shouldRun('plan', 1)) {
  log('── Plan ──')
  lastResult = await runPhaseWorkflow(sk('datum-plan'), phaseArgs, 'plan')
  if (!lastResult.gatePassed) {
    haltedAt = 'plan'
    log(`Plan gate ${lastResult.gateNeedsHuman ? 'held' : 'FAILED'}: ${lastResult.gateMessage || 'needs approval'}. Review TASKS.md, then: datum go --start-from properties`)
  } else {
    log(`Plan complete — ${lastResult.taskCount || '?'} tasks`)
    await markPhaseComplete('plan')
  }
}

// Properties
if (shouldRun('properties', 2)) {
  log('── Properties ──')
  lastResult = await runPhaseWorkflow(sk('datum-properties'), phaseArgs, 'properties')
  // Properties' gate verdict used to be ignored here entirely.
  if (!lastResult.gatePassed) {
    haltedAt = 'properties'
    log(`Properties gate ${lastResult.gateNeedsHuman ? 'held' : 'FAILED'}: ${lastResult.gateMessage || 'needs review'}. Review PROPERTIES.md, then: datum go --start-from act`)
  } else {
    log('Properties complete')
    await markPhaseComplete('properties')
  }
}

// Act — inlined from datum-tdd-act to avoid workflow() nesting limit
// (datum-tdd-act calls setup/lane/merge/docs/triage as child workflows;
//  if datum-go also called datum-tdd-act as a child, that would be 2 levels deep)
log(`[debug] shouldRun act=${shouldRun('act', 3)} startIdx=${startIdx} haltedAt=${haltedAt} activePhases=${JSON.stringify(activePhases)}`)

if (shouldRun('act', 3)) {
  log('── Act ──')
  let inFlightBatch: { batchRunId: string; batchTag: string; epicBranch: string } | null = null
  try {

  const testCommand = globalCfg.test_command || DEFAULT_CONFIG.test_command
  const language = globalCfg.language || DEFAULT_CONFIG.language
  // Mirrors datum-tdd-act.ts's cfg exactly (#524 dogfooding audit) — this
  // inline Act block exists specifically to replicate that standalone
  // workflow, and test_framework had drifted out of it. Unread by
  // datum-tdd-act-lane.ts today, so this was latent, not an active bug —
  // closing the drift before something starts reading it only on one path.
  const testFramework: string | undefined = globalCfg.test_framework

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
  // Safe: an unparseable result leaves epicBranch === '', which the throw
  // immediately below already catches — the {epicBranch:''} default never
  // gets acted on as though it were a real, resolved branch.
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
  // The plan never travels through an LLM turn. A reader echo normalised
  // "§4" → "§ 4" inside acceptance criteria (wf_6bfbd9f2-510: spec hashes
  // changed, completed lanes re-ran); the base64 chunk relay that replaced
  // it was GENERATED by the runner past ~2.7 KB rather than copied
  // (wf_5791e11f-693). The scheduler runs on the compact digest
  // `datum lane-plan-digest` wrote in the act-start batch, byte-verified
  // (wc -c + git hash-object); each lane fetches its own full spec at intake.
  const digestResult = lanePlanDigestFromSteps(actStartResult, lanePlanPath)
  if (!digestResult.ok || !digestResult.digest) throw new Error(digestResult.error)
  const lanePlan: LanePlanDigest = digestResult.digest

  const waves = buildWaves(lanePlan)
  if (waves.length === 0 || Object.keys(lanePlan.lanes || {}).length === 0) {
    throw new Error('Lane plan has 0 tasks — nothing to execute')
  }
  log(`Topology: ${lanePlan.total_lanes} lanes in ${waves.length} waves`)

  // Epic-scoped completion markers: lanes merged in prior runs/sessions skip entirely.
  // A marker counts only if status=completed, its spec_hash matches the current lane
  // plan entry, and its merge_commit is an ancestor of the epic branch tip.
  const slug = epicSlug(epicBranch)
  // Safe: an unparseable result yields {} — no lane matches any prior marker,
  // so every lane is treated as NOT already merged. That's the conservative
  // direction (a lane redundantly re-runs instead of a real completed lane
  // being wrongly skipped), never the direction that would silently let a
  // phase "pass" on missing evidence.
  const priorMarkers = parseAgentJson(stepStdout(actStartResult, 'lane-state-read') || '', {}) as Record<string, { status: string; spec_hash: string; ancestor: boolean }>
  const alreadyMerged = lanePlan.topological_order.filter((id: string) => {
    const m = priorMarkers[id]
    return !!m && m.status === 'completed' && m.ancestor === true && m.spec_hash === digestSpecHash(lanePlan, id)
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
    // Read by the act catch block: a throw between setup and merge leaves
    // this batch's worktrees registered unless it cleans them up itself.
    inFlightBatch = { batchRunId, batchTag, epicBranch }

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
      { batchRunId, epicBranch, batchLaneIds: runnableBatchIds, lanePlan, lanePlanPath, batchTag, agentTypes: agentTypeArgs(), configFingerprint },
    ) as SetupResult

    // Lane execution — direct child workflow
    const act = await workflow(
      { scriptPath: sk('datum-tdd-act-lane') },
      {
        batchLaneIds: runnableBatchIds, lanePlan, worktreePaths: setup.worktreePaths, batchTag,
        // yolo (#356): lets a blocked GREEN auto-widen allowed_write_files
        // in the lane runner, same as datum-tdd-act passes it.
        cfg: { lanePlanPath, epicBranch, runId: batchRunId, testCommand, language, test_framework: testFramework, skeletonDir, yolo, agentTypes: agentTypeArgs(), configFingerprint },
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
    const mergeResult = await workflow(
      { scriptPath: sk('datum-tdd-act-merge') },
      {
        epicBranch,
        completedIds: mergedIds,
        results: actResults,
        batchRunId,
        topoOrder: lanePlan.topological_order,
        batchTag,
        agentTypes: agentTypeArgs(),
        configFingerprint,
        laneState: mergedIds.length > 0
          ? { epicSlug: slug, entries: mergedIds.map(id => ({ task_id: id, spec_hash: digestSpecHash(lanePlan, id) })) }
          : null,
      },
    ) as MergeResult | null
    // The merge child ran its own cleanup step; nothing for the catch to do.
    inFlightBatch = null

    // A lane the runner completed but whose squash-merge did not land has
    // shipped nothing. Demote it to failed so the halt below fires and a
    // resume re-attempts the merge instead of Validate/Review/Closeout
    // running on an unmerged epic (eedom run wf_2a5ede48-358).
    // On a partial merge the lanes that landed before the conflicting one
    // are committed and kept (datum/worktree_manager.py LaneMergeError), so
    // only the lanes the merge did not land are demoted.
    if (mergedIds.length > 0 && (!mergeResult || mergeResult.failed || !mergeResult.merged)) {
      const failedLane = mergeResult && typeof mergeResult.failedLane === 'string' ? mergeResult.failedLane : ''
      const why = mergeResult
        ? (failedLane ? `squash-merge of ${failedLane} did not land` : 'squash-merge step exited non-zero')
        : 'merge workflow returned null'
      const landed = new Set(mergeResult && Array.isArray(mergeResult.mergedIds) ? mergeResult.mergedIds : [])
      const unmerged = mergedIds.filter((id) => !landed.has(id))
      for (const id of unmerged) {
        const i = actCompleted.indexOf(id)
        if (i >= 0) actCompleted.splice(i, 1)
        actFailures.push(id)
        actResults[id] = { task_id: id, status: 'failed', stage: 'MERGE', error: `merge_failed: ${why}${batchTag}` }
      }
      log(`Merge${batchTag} FAILED — demoted [${unmerged.join(', ')}] from completed to failed (${why})${landed.size > 0 ? `; landed: [${[...landed].join(', ')}]` : ''}`)
    }
  }

  // Docs — direct child workflow. Its outcome is surfaced here: a docs-sync
  // that was written but refused at commit used to vanish from the run.
  // Fails soft: the lanes are merged by now and the halt record still has to
  // be written — a docs failure lands in the Act summary, never aborts the
  // run (wf_b1c88e09-036: a thrown docs child killed datum-go with no summary).
  let docsResult: DocsResult | null = null
  try {
    docsResult = await workflow(
      { scriptPath: sk('datum-tdd-act-docs') },
      { completedLanes: actCompleted, lanePlan, runId, agentTypes: agentTypeArgs(), configFingerprint },
    ) as DocsResult | null
  } catch (exc) {
    log(`[warn] docs_workflow_failed: ${(exc as Error).message} — continuing; docs may be stale or left uncommitted`)
    docsResult = { synced: false, committed: false, failure_reason: `docs_workflow_failed: ${(exc as Error).message}` } as DocsResult
  }
  if (docsResult && docsResult.committed === false) {
    log(`[warn] Docs sync wrote [${(docsResult.files || []).join(', ')}] but the commit was refused: ${docsResult.failure_reason || 'unknown'} — the files are left modified in the checkout`)
  } else if (docsResult && docsResult.failure_reason) {
    // Nothing was written, but the phase did not do its job: say so by name
    // (docs_check_no_result, "wrote no files", ...) instead of reading as synced.
    log(`[warn] Docs sync did not complete: ${docsResult.failure_reason}`)
  }

  const actSkipped = Object.keys(actResults).filter(id => actResults[id]?.status === 'skipped')
  const actBlocked = Object.keys(actResults).filter(id => actResults[id]?.status === 'blocked')
  // A GREEN blocked on files outside its scope is a lane-plan defect, not a
  // dependency block: name it, list it, and triage it even when no lane
  // failed (caliper BUG L — the root cause was only in the journal).
  const actNeedsWrite = actBlocked.filter(id => Array.isArray(actResults[id]?.needs_write))
  if (actNeedsWrite.length > 0) {
    log('\nLEAD APPROVAL NEEDED — GREEN is blocked on files outside allowed_write_files:')
    for (const id of actNeedsWrite) {
      const r = actResults[id]
      log(`  ${id}: needs_write=[${(r?.needs_write || []).join(', ')}]`)
      log(`    ${r?.error || ''}`)
    }
    log('  To approve: add the listed paths to that lane\'s `files` in lane-plan.json, then re-run act (datum go --start-from act). In yolo mode, paths inside src/ are widened automatically and GREEN re-runs once.')
  }

  // Triage — direct child workflow
  if (actFailures.length > 0 || actNeedsWrite.length > 0) {
    try {
      const triage = await workflow(
        { scriptPath: sk('datum-tdd-act-triage') },
        { failures: [...actFailures, ...actNeedsWrite], blocked: actBlocked.filter(id => !actNeedsWrite.includes(id)).map(id => actResults[id]), results: actResults, lanePlan, runId, epicBranch, agentTypes: agentTypeArgs() },
      ) as { filed?: number; consumer_findings?: number; skipped?: number } | null
      log(`Triage: ${triage?.filed ?? 0} filed, ${triage?.consumer_findings ?? 0} consumer finding(s), ${triage?.skipped ?? 0} skipped`)
    } catch (exc) {
      // Triage is reporting; a crash there must not turn finished lanes into an Act crash.
      log(`[warn] triage_workflow_failed: ${(exc as Error).message} — lane failures are still recorded above`)
    }
  }

  log(`Act ${actFailures.length > 0 || actBlocked.length > 0 ? 'finished with failures' : 'complete'} — ${actCompleted.length}/${lanePlan.total_lanes} succeeded, ${actFailures.length} failed, ${actSkipped.length} skipped, ${actBlocked.length} blocked`)
  // approvalLanes are reported apart from dependency blocks (caliper BUG L:
  // {"failed":0,"blocked":2} hid that one of the two was the root cause).
  const actDepBlocked = actBlocked.filter(id => !actNeedsWrite.includes(id))
  const needsApproval: Record<string, string> = {}
  for (const id of actNeedsWrite) needsApproval[id] = actResults[id]?.error || 'green_blocked_needs_write'
  lastResult = { completed: actCompleted.length, failed: actFailures.length, skipped: actSkipped.length, blocked: actDepBlocked.length, approval: actNeedsWrite.length, failedLanes: actFailures, skippedLanes: actSkipped, blockedLanes: actDepBlocked, approvalLanes: actNeedsWrite, needsApproval }

  // Any failed, blocked, or unmerged lane means the epic is incomplete. Halt
  // here — in yolo mode too — rather than let Validate/Review/Closeout report
  // (and Closeout's housekeeping delete lane branches and pipeline-state) for
  // an epic that did not land. Act is deliberately NOT marked complete on halt
  // so a resume re-enters Act, where cross-run completion markers skip the
  // lanes that did merge (#331).
  if ((actCompleted.length === 0 && lanePlan.total_lanes > 0) || actFailures.length > 0 || actBlocked.length > 0) {
    haltedAt = 'act'
    log(`Act halted: ${actFailures.length} failed, ${actBlocked.length} blocked, ${actCompleted.length}/${lanePlan.total_lanes} merged — not continuing to validate/review/closeout. Fix the failed lanes, then re-run datum go (Act resumes from the lanes that have not merged).`)
  } else {
    await markPhaseComplete('act')
  }
  } catch (exc) {
    // FLOW.md §5 open item 3: the Act phase runs inline (actStartSteps, the
    // lane-plan digest relay, the setup/lane/merge
    // batch loop, docs, triage) rather than through runPhaseWorkflow, so an
    // exception raised anywhere in that body (lane_plan_relay_mismatch,
    // context_relay_mismatch, a setup/lane/merge child failing) used to end
    // the whole workflow uncaught: no Act summary, no halt record, haltedAt
    // unset, pipeline-state left as it was, and no resume path. Fold it into
    // the same halt a failed lane already produces above instead: halt at
    // 'act', deliberately skip recording Act as complete so a resume
    // re-enters Act, and do not propagate the exception further — fall
    // through to the normal halt reporting below with pipeline-state
    // untouched.
    const message = (exc as Error).message
    log(`[warn] act_phase_failed: ${message}`)
    haltedAt = 'act'
    lastResult = { failed: 1, failedLanes: [], error: message }
    // The merge child (where cleanup lives) never ran for the batch in
    // flight: deregister its root and lane worktrees so the next run's setup
    // does not die on "already used by worktree" (caliper BUG O). Lane
    // branches with commits are preserved by the CLI. Fail-soft.
    if (inFlightBatch) {
      const { batchRunId, batchTag, epicBranch } = inFlightBatch
      try {
        const cleanup = await runBatch(cleanupSteps(batchRunId, epicBranch), stageOpts('cli', { label: `cleanup-after-crash${batchTag}`, phase: 'Act', model: model('fast') }))
        log(`  cleanup${batchTag}: ${stepStdout(cleanup, 'cleanup') || describeFailure(cleanup, 'cleanup')}`)
      } catch (cleanupExc) {
        log(`[warn] cleanup_after_crash_failed${batchTag}: ${(cleanupExc as Error).message}`)
      }
    }
  }
} else if (activePhases.includes('act' as Phase)) {
  log(`[warn] Act phase was in activePhases but shouldRun returned false — startIdx=${startIdx} haltedAt=${haltedAt}`)
}

// Validate
if (shouldRun('validate', 4)) {
  log('── Validate ──')
  lastResult = await runPhaseWorkflow(sk('datum-validate'), phaseArgs, 'validate')
  // testsPassed is the independent test run's real exit (b321e89) and
  // gatePassed is `datum gate validate`'s exit code — both halt in every mode.
  if (!lastResult.testsPassed || !lastResult.gatePassed) {
    haltedAt = 'validate'
    log(`Validate ${!lastResult.testsPassed ? 'FAILED — tests are red' : `gate ${lastResult.gateNeedsHuman ? 'held' : 'FAILED'}: ${lastResult.gateMessage || 'needs review'}`}. Pipeline halted.`)
  } else {
    log('Validate complete')
    await markPhaseComplete('validate', !!lastResult.testsPassed)
  }
}

// Review
if (shouldRun('review', 5)) {
  log('── Review ──')
  lastResult = await runPhaseWorkflow(sk('datum-review'), phaseArgs, 'review')
  // gatePassed is `datum gate review`'s exit code (#368) — halts in every
  // mode, same as Refine/Plan/Properties/Validate. canMerge is the review
  // swarm's own high/critical-findings verdict, which yolo may bypass.
  if (!lastResult.gatePassed) {
    haltedAt = 'review'
    log(`Review gate ${lastResult.gateNeedsHuman ? 'held' : 'FAILED'}: ${lastResult.gateMessage || 'needs review'}. Fix, then: datum go --start-from validate`)
  } else if (!yolo && !lastResult.canMerge) {
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
  try {
    lastResult = await workflow({ scriptPath: sk('datum-closeout') }, { ...phaseArgs, runId: resolvedRunId }) as PhaseResult
    log('Closeout complete')
    await markPhaseComplete('closeout')
  } catch (exc) {
    // Closeout has no gate field to fold a thrown failure into (unlike
    // Refine/Plan/Review) — halt explicitly instead of letting it crash
    // datum-go with no halt record and no summary.
    const message = (exc as Error).message
    haltedAt = 'closeout'
    log(`[warn] closeout_workflow_failed: ${message}. Fix, then: datum go --start-from closeout`)
  }
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
