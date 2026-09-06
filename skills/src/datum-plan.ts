import { renderPrompt, parseAgentJson, parseAgentJsonStrict, assertAcyclicTasks, buildContextFilesSection } from './shared/utils'
import { model, DEFAULT_CONFIG } from './shared/models'
import { publishLanePlan } from './shared/tracker'
import { stageOpts, bootstrapOpts, configureAgentTypes, readAgentTypeConfig } from './shared/agent-types'
import { batchCommandPrompt, setBatchCacheKey, setBatchRoot, parseBatchResult, stepStdout, type BatchResult } from './shared/batch'
import { contextProbeSteps, contextRelayPlan, contextInlineSteps, contextInlineRetryPrompt, contextFromRelay, mergeRelayRetry, contextSlot, contextWitnessInstruction, contextWitnessWrapInstruction, unwrapWitnessedArray, assertReadWitness, type ContextFile } from './shared/context-relay'
import { configReadSteps, configFromSteps } from './shared/config-steps'
import { planBuildSteps, planBuildFromSteps, tasksJsonBlobSha, skeletonBatchSteps, skeletonBatchFromSteps } from './shared/plan-steps'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
import { writeFileSteps, writeFileFromSteps, writeFileBlobSha } from './shared/write-steps'
import type { PhaseArgs } from './shared/types'
import planApproachesTemplate from './prompts/plan-approaches.md'
import planImpactTemplate from './prompts/plan-impact.md'
import planTriageTemplate from './prompts/plan-triage.md'
import planDeepenTemplate from './prompts/plan-deepen.md'
import { gateSteps, parseGateResult } from './shared/gate'
import { routingRestoreSteps, routingRestoreFromSteps, ROUTING_PATH } from './shared/routing-steps'
import { runBatch } from './shared/agents'

export const meta = {
  name: 'datum-plan',
  description: 'Decompose SPEC.md into tasks.json + lane-plan.json — approach, impact, decompose, triage, deepen',
  phases: [
    { title: 'Read', detail: 'read SPEC.md, CURRENT_STATE.md, prior failures' },
    { title: 'Decompose', detail: 'approach → impact → tasks → build lane-plan' },
    { title: 'Triage', detail: 'evaluate complexity, deepen if needed, gate' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = ((typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})) as PhaseArgs
const yolo: boolean = !!a.yolo
// #368: the parent's switches are honoured BEFORE the first agent() call —
// with `agent_types: false` the reads below must not go out as 'datum-cli'.
if (a.agentTypes && typeof a.agentTypes === 'object') configureAgentTypes(a.agentTypes)
// Resume cache key (#354): an edited SPEC.md must re-run the reads and the gates.
setBatchCacheKey(a.configFingerprint || '')
setBatchRoot(typeof a.repoRoot === 'string' ? a.repoRoot : '')

// ── Read (deterministic batch: branch/epic-dir + byte-verified SPEC.md
// relay, replacing the LLM `reader` echo of util-read-context.md — an LLM
// echoing a file is lossy (a 90 KB relay came back as 6.7 KB of "successful"
// abridged content in dogfooding), and nothing verified it. current_state /
// prior_defects / error_history are auxiliary (already-truncated) reads, so
// they ride along as extraCommands rather than through the byte-verified
// file relay. Mirrors the fix already applied to datum-refine.ts /
// datum-properties.ts (#368 follow-up). ──

phase('Read')

// Two-phase relay (shared/context-relay.ts): probe sizes first, inline only
// what fits the budget, hand anything larger to the agents by path + hash —
// a 31 KB SPEC relayed in one batch was spilled by the harness and the
// runner fabricated the echo (caught as context_relay_mismatch, run
// wf_fcf49a90-0bf).
const NOT_FOUND_MARKER = '__DATUM_CTXFIELD_NOT_FOUND__'
const SPEC_REL = 'docs/epics/$__eb/SPEC.md'
const probeSteps = contextProbeSteps({
  files: [SPEC_REL],
  extraCommands: [
    { name: 'current-state', command: `if [ -f CURRENT_STATE.md ]; then head -80 CURRENT_STATE.md; else printf '%s' '${NOT_FOUND_MARKER}'; fi` },
    { name: 'prior-defects', command: `jq -r '.brief_defects[]? | "\\(.surfaced_by_stage)\\t\\(.missing_ac)"' .datum/runs/*/closeout-data.json 2>/dev/null` },
    { name: 'error-history', command: `if [ -f .datum/ERRORS.md ]; then head -40 .datum/ERRORS.md; else printf '%s' '${NOT_FOUND_MARKER}'; fi` },
  ],
})
const readBatch = parseBatchResult(
  await agent(batchCommandPrompt(probeSteps), bootstrapOpts('cli', { label: 'read-context', model: model('fast') })),
  probeSteps,
)
const relayPlan = contextRelayPlan(readBatch, [SPEC_REL])
let inlineBatch: BatchResult | null = null
const inlineSteps = contextInlineSteps(relayPlan.inline)
if (relayPlan.inline.length > 0) {
  inlineBatch = parseBatchResult(
    await agent(batchCommandPrompt(inlineSteps), bootstrapOpts('cli', { label: 'read-context-files', model: model('fast') })),
    inlineSteps,
  )
}
let ctx = contextFromRelay(readBatch, inlineBatch, relayPlan)
// A relayed file the runner rewrote in transit (caliper eedom
// wf_9bf2c994-801) is re-fetched once with a fresh runner; what still
// mismatches is deferred to the consuming agent, never a halt.
if (ctx.mismatched.length > 0) {
  log(`read-context: context_relay_mismatch on ${ctx.mismatched.join(', ')} — re-fetching once with a fresh runner`)
  const retryBatch = parseBatchResult(
    await agent(contextInlineRetryPrompt(inlineSteps), bootstrapOpts('cli', { label: 'read-context-files:retry', model: model('fast') })),
    inlineSteps,
  )
  ctx = mergeRelayRetry(ctx, contextFromRelay(readBatch, retryBatch, relayPlan))
}
for (const warning of ctx.warnings) log(`read-context: ${warning}`)

const epicDir: string = ctx.epicDir
const specFile = ctx.files[SPEC_REL]
if (!specFile.exists) throw new Error(`SPEC.md not found at ${epicDir}/SPEC.md. Run datum-refine first.`)
// Either the verified content or a mandatory "Read it with the Read tool"
// instruction (contextSlot) — every prompt slot below takes either.
const specContent: string = contextSlot(specFile)

log(`Branch: ${ctx.branch}, SPEC: ${specFile.bytes} bytes${specFile.inlined ? '' : ' (over relay budget — agents read it themselves)'}`)

const currentStateRaw = stepStdout(readBatch, 'current-state')
const currentState: string | null = (currentStateRaw === null || currentStateRaw === NOT_FOUND_MARKER) ? null : currentStateRaw
const priorDefects: string = stepStdout(readBatch, 'prior-defects') || ''
const errorHistoryRaw = stepStdout(readBatch, 'error-history')
const errorHistory: string | null = (errorHistoryRaw === null || errorHistoryRaw === NOT_FOUND_MARKER) ? null : errorHistoryRaw

const priorFailures: string = [priorDefects, errorHistory || ''].filter(Boolean).join('\n') || '(no prior failure data)'

// Deterministic config read: two `cat` steps in one datum-cli batch, parsed
// and merged in TS (shared/config-steps.ts) — replaces the old LLM "read two
// JSON files and merge them by hand" relay (nothing verified that relay; a
// wrong merged field, e.g. test_command, silently poisoned every downstream
// lane). Shared with datum-validate.ts / datum-tdd-act.ts (#368 item 2).
const configReadStepList = configReadSteps()
const configBatchRaw = await agent(batchCommandPrompt(configReadStepList), bootstrapOpts('cli', { label: 'read-config', model: model('fast') }))
const repoCfg = { ...DEFAULT_CONFIG, ...configFromSteps(parseBatchResult(configBatchRaw, configReadStepList)) } as Record<string, unknown>
// #368: args (from datum-go) win, else the repo config, else the defaults.
// Standalone run (no parent args): switches come from the repo config just read.
if (!(a.agentTypes && typeof a.agentTypes === 'object')) configureAgentTypes(readAgentTypeConfig(repoCfg))
const language = (repoCfg.language as string) || DEFAULT_CONFIG.language
const testFramework = (repoCfg.test_framework as string) || DEFAULT_CONFIG.test_framework

// context_files: the same two-phase relay (probe → budgeted inline → slot).
// Small files are inlined byte-verified; large ones reach the decompose
// agent as a mandatory Read instruction with path, bytes and hash; missing
// ones stay null so buildContextFilesSection warns about them.
const contextFilesList: string[] = (repoCfg.context_files as string[] | undefined) || []
const contextFileContents: Record<string, string | null> = {}
// The relay records for the context_files that exist — the decompose read
// witness (below) covers every one of them that ended up deferred.
const contextFileEntries: ContextFile[] = []
const contextFilesWarnings: string[] = []
if (contextFilesList.length > 0) {
  const cfProbeSteps = contextProbeSteps({ files: contextFilesList })
  const cfProbe = parseBatchResult(
    await agent(batchCommandPrompt(cfProbeSteps), stageOpts('cli', { label: 'probe-context-files', model: model('fast') })),
    cfProbeSteps,
  )
  const cfPlan = contextRelayPlan(cfProbe, contextFilesList)
  let cfInline: BatchResult | null = null
  const cfInlineSteps = contextInlineSteps(cfPlan.inline)
  if (cfPlan.inline.length > 0) {
    cfInline = parseBatchResult(
      await agent(batchCommandPrompt(cfInlineSteps), stageOpts('cli', { label: 'read-context-files', model: model('fast') })),
      cfInlineSteps,
    )
  }
  let cf = contextFromRelay(cfProbe, cfInline, cfPlan)
  if (cf.mismatched.length > 0) {
    log(`context_files: context_relay_mismatch on ${cf.mismatched.join(', ')} — re-fetching once with a fresh runner`)
    const cfRetry = parseBatchResult(
      await agent(contextInlineRetryPrompt(cfInlineSteps), stageOpts('cli', { label: 'read-context-files:retry', model: model('fast') })),
      cfInlineSteps,
    )
    cf = mergeRelayRetry(cf, contextFromRelay(cfProbe, cfRetry, cfPlan))
  }
  for (const warning of cf.warnings) contextFilesWarnings.push(warning)
  for (const relPath of contextFilesList) {
    const f = cf.files[relPath]
    contextFileContents[relPath] = f.exists ? contextSlot(f) : null
    if (f.exists) contextFileEntries.push(f)
  }
}
const contextFilesSection: string = buildContextFilesSection(
  contextFileContents,
  (msg: string) => contextFilesWarnings.push(msg),
)
for (const warning of contextFilesWarnings) log(`context_files: ${warning}`)

import planDecomposeTemplate from './prompts/plan-decompose.md'

// ── Decompose (approach → impact → decompose → build — all substantive, kept separate) ──

phase('Decompose')

// Approach
// FLOW.md open gap 2: nothing verified that a deferred specContent (over the
// relay budget) was actually read rather than skipped. contextWitnessInstruction
// is '' when SPEC.md was inlined, so this is a no-op prompt change in the
// common case; when deferred, it demands a git-hash-object witness in the
// agent's JSON output, and assertReadWitness gates it below.
const approachesRaw = await agent(
  renderPrompt(planApproachesTemplate, { specContent, currentState: currentState || '(not available)' }) + contextWitnessInstruction([specFile]),
  { label: 'propose-approaches', model: model('balanced') },
)

interface Approach { name: string; description: string; tradeoffs: string; modules_touched: string[]; estimated_tasks: number; blast_radius: string }
interface ApproachResult { approaches: Approach[]; recommended: number; recommendation_reason: string }

// Strict: a silent {approaches: []} fallback leaves `chosen` undefined below,
// which then silently feeds "undefined" into the decompose prompt's
// chosenApproach — the task decomposition would proceed against a
// nonexistent approach with no trace the propose-approaches agent ever
// failed to produce parseable output.
const approaches: ApproachResult = parseAgentJsonStrict<ApproachResult>(approachesRaw as string, 'propose-approaches')
assertReadWitness([specFile], approaches)
// A parseable but empty list would leave `chosen` undefined and feed "undefined" to decompose.
if (!Array.isArray(approaches.approaches) || approaches.approaches.length === 0) throw new Error(`plan_no_approaches: propose-approaches returned no approaches (recommendation: ${approaches.recommendation_reason || 'none'})`)
const chosen: Approach = approaches.approaches[approaches.recommended] || approaches.approaches[0]
log(`Selected: ${chosen?.name || 'default'} — ${approaches.recommendation_reason}`)

// Impact
// Not read-witness-gated: impactRaw is kept as free-form text (impactStr
// below), never parsed as JSON, so there is no JSON field to carry a
// read_witness in.
const impactRaw = await agent(
  renderPrompt(planImpactTemplate, { wt: '.', filesList: (chosen?.modules_touched || []).join('\n') || specContent }),
  { label: 'impact-analysis', model: model('balanced') },
)
const impactStr: string = typeof impactRaw === 'string' ? impactRaw : JSON.stringify(impactRaw)

// Decompose (opus for complex)
// Read-witness-gated (FLOW.md open gap 2): decompose-tasks' contract is a
// bare JSON array (it feeds datum lane-plan's schema validation directly),
// which has no slot for a read_witness. So when — and only when — the SPEC
// or a context_file was deferred, contextWitnessWrapInstruction asks for
// `{read_witness, tasks: [...]}` and unwrapWitnessedArray takes the array
// back out; tasks.json on disk is the same bare array as before. When
// nothing is deferred the prompt and the parse are byte-identical to before.
const isComplex: boolean = (chosen?.blast_radius === 'high') || ((chosen?.estimated_tasks || 0) > 5)
const decomposeModel = isComplex ? model('deep') : model('balanced')
if (isComplex) log('Complex epic — using opus for decomposition')

const decomposeFiles: ContextFile[] = [specFile, ...contextFileEntries]
const tasksRaw = await agent(
  renderPrompt(planDecomposeTemplate, { specContent, chosenApproach: JSON.stringify(chosen), scanContext: impactStr, priorFailures, language, testFramework, contextFilesSection })
    + contextWitnessWrapInstruction(decomposeFiles, 'tasks'),
  { label: 'decompose-tasks', model: decomposeModel },
)

// Safe: an unparseable result yields [], which the throw immediately below
// already catches (0 tasks is refused regardless of whether it came from a
// real empty decomposition or a parse failure). With something deferred, a
// bare array (no witness) fails assertReadWitness — context_read_unverified.
const tasksParsed: unknown = typeof tasksRaw === 'string' ? parseAgentJson(tasksRaw as string, [] as Record<string, unknown>[]) : tasksRaw
assertReadWitness(decomposeFiles, tasksParsed)
interface PlanTask { id: string; title: string; depends_on?: string[]; [key: string]: unknown }
const tasks = unwrapWitnessedArray(tasksParsed, 'tasks') as PlanTask[] | null
if (!Array.isArray(tasks) || tasks.length === 0) {
  throw new Error(`Task decomposition returned 0 tasks — refusing to write an empty lane plan. Raw output: ${String(tasksRaw).slice(0, 300)}`)
}
assertAcyclicTasks(tasks)
const tasksJson: string = JSON.stringify(tasks)
log(`Decomposed into ${tasks.length} tasks`)
for (const task of tasks) {
  const deps = task.depends_on && task.depends_on.length > 0 ? ` (depends: ${task.depends_on.join(', ')})` : ''
  log(`  ${task.id}: ${task.title}${deps}`)
}

// Build: write tasks.json + run `datum lane-plan` — but do NOT commit yet.
// `datum lane-plan` validates tasks.json against task.schema.json (id/slug
// patterns, required fields) and refuses to write on failure; the plan gate
// below checks the resulting lane-plan.json. Both run before anything is
// committed so a plan that fails the schema never lands three commits first (#352).
//
// Deterministic batch (shared/plan-steps.ts): the JSON goes to disk through
// a quoted heredoc and the on-disk blob sha is compared with the sha of the
// bytes this script intended to write. A runner that abridged or
// re-serialised a task used to produce a different plan than decompose
// did, silently — now that is plan_write_mismatch and the run halts.
const buildSteps = planBuildSteps({ epicDir, tasksJson })
const build = planBuildFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(buildSteps), stageOpts('cli', { label: 'build-lane-plan', model: model('fast') })),
  buildSteps,
), tasksJsonBlobSha(tasksJson))
if (!build.ok) throw new Error(build.error)

// ── Early plan gate: schema + structure, right after lane-plan and BEFORE the
// skeleton/deepen phases (#352). `--approve` skips only the human-approval
// hold; every structural check (lane-plan schema, topological order, file
// overlap, assumption audit) still runs. The human hold is re-checked by the
// final gate at the end of Triage.
const earlyGateSteps = gateSteps('plan', ' --approve')
const earlyGate = parseGateResult(await runBatch(earlyGateSteps, stageOpts('cli', { label: 'gate-early', model: model('fast') })))
if (!earlyGate.passed) {
  throw new Error(`Plan gate failed right after datum lane-plan — plan NOT committed (fix tasks.json and re-run datum plan): ${earlyGate.message || 'no message'}`)
}
log('Early plan gate PASSED (schema + structure)')

// Commit exactly the three plan artifacts through a commitFilesSteps batch
// (shared/commit-steps.ts): the exit code is the verdict, no runner-typed
// {"exit_code": 0}, and a failed or empty commit halts by name.
async function commitPlanFiles(files: string[], message: string, label: string): Promise<string> {
  const commitStepList = commitFilesSteps({ wt: '.', files, message })
  const commit = commitFilesFromSteps(parseBatchResult(
    await agent(batchCommandPrompt(commitStepList), stageOpts('cli', { label, model: model('fast') })),
    commitStepList,
  ))
  if (commit.error) throw new Error(`plan_commit_failed: ${commit.error}`)
  // A missing file fails `git add` (commit.error); nothing-to-commit means the
  // files already match HEAD — a resume re-running a landed step.
  if (commit.nothingToCommit) { log(`${label}: ${files.join(', ')} unchanged since the last run — already committed`); return 'unchanged' }
  return commit.sha
}

const planCommit = await commitPlanFiles(
  [`${epicDir}/tasks.json`, `${epicDir}/lane-plan.json`, `${epicDir}/TASKS.md`],
  'plan: tasks.json + lane-plan.json + TASKS.md',
  'commit-lane-plan',
)
log(`Lane plan built, gated, and committed (${planCommit})`)

// ── Skeleton batch — generate test contracts while Claude still has full spec context ──
const skeletonDir = `${epicDir}/skeletons`
const skeletonSteps = skeletonBatchSteps({ epicDir, language })
const skeleton = skeletonBatchFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(skeletonSteps), stageOpts('cli', { label: 'skeleton-batch', model: model('fast') })),
  skeletonSteps,
))
if (!skeleton.ok) throw new Error(skeleton.error)
await commitPlanFiles([skeletonDir], 'plan: pre-generate RED skeletons', 'commit-skeletons')
log(`Skeletons pre-generated in ${skeletonDir}`)

// ── Triage + Deepen + Gate (triage decides, deepen appends findings; the script writes, commits and gates) ──

phase('Triage')

// Triage: the agent only decides. The script writes the decision to the
// routing file (byte-verified batch), commits it, and runs `datum gate
// triage` on it — the agent used to write and commit the file itself with
// its reply discarded, and that gate had no caller.
const triageRaw = await agent(
  planTriageTemplate,
  { label: 'triage-decision', model: model('fast') },
)

interface TriageDecision { decision: string; reason: string; triggers: string[] }
// Safe: the lane plan itself already passed the early structural gate above;
// triage only decides whether an OPTIONAL extra research pass ('deepen')
// runs before the final gate. Defaulting to 'properties' (skip deepen) on an
// unparseable response withholds that optional enrichment rather than
// enabling a skipped check, and the fallback's own reason field
// ('parse failure') makes the degraded path visible in the log below.
const triage: TriageDecision = parseAgentJson(triageRaw as string, { decision: 'properties', reason: 'parse failure', triggers: [] } as TriageDecision)
log(`Triage: ${triage.decision} — ${triage.reason}`)

const routingJson = JSON.stringify(triage, null, 2)
const routingSteps = writeFileSteps({ path: '.datum/routing.json', content: routingJson })
const routingWritten = writeFileFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(routingSteps), stageOpts('cli', { label: 'write-routing', model: model('fast') })),
  routingSteps,
), { path: '.datum/routing.json', expectedSha: writeFileBlobSha(routingJson), prefix: 'routing' })
if (!routingWritten.ok) throw new Error(routingWritten.error)
// Not committed: routing.json is run state under .datum, which datum's own
// gitignore-check ignores and a consumer's global excludes may ignore
// outright (`git add exited 1: .datum | hint: Use -f`, elonchesd
// wf_1b098b4d-33c). `datum gate triage` reads it from disk; nothing reads
// it from git. The decision itself lands in TASKS.md/lane-plan.json.
const triageGateSteps = gateSteps('triage', '')
const triageGate = parseGateResult(await runBatch(triageGateSteps, stageOpts('cli', { label: 'gate-triage', model: model('fast') })))
if (!triageGate.passed) throw new Error(`Triage gate failed — routing.json rejected: ${triageGate.message || 'no message'}`)
// A consumer that committed routing.json under an earlier datum version
// would otherwise be left with a modified tracked file after every plan run
// (caliper eedom wf_4f739141-c8c). The gate has read the fresh decision;
// restore the committed content and name the condition. Fails soft: the
// decision already landed, a dirty tree is a nuisance, not a wrong plan.
const routingRestore = routingRestoreFromSteps(await runBatch(routingRestoreSteps(), stageOpts('cli', { label: 'routing-restore', model: model('fast') })))
if (routingRestore.tracked === true) log(`routing_json_tracked: ${ROUTING_PATH} is committed in this repo and was restored after the triage gate — untrack it (git rm --cached ${ROUTING_PATH}) so plan runs leave the tree clean`)
else if (routingRestore.tracked === null) log(`routing_restore_unchecked: could not tell whether ${ROUTING_PATH} is tracked; a committed copy may show as modified`)

// Deepen (conditional). The research agent APPENDS `## Research Findings`
// to TASKS.md and touches nothing else (tasks.json is untouched by design).
// This used to be followed by a `datum lane-plan` rebuild "+ commit" inside
// the same prompt — the rebuild regenerates TASKS.md from tasks.json, which
// wiped the findings just appended (the very section `datum gate deepen`
// requires), and nothing ever ran that gate. Now: commit TASKS.md
// deterministically, then run the deepen gate on it.
if (triage.decision === 'deepen') {
  const deepenRaw = await agent(
    planDeepenTemplate,
    { label: 'deepen-research', model: model('balanced') },
  )
  // Safe: pure telemetry — these counts are only logged, never used to
  // decide anything (the commit and gate below are independent of this parse).
  const deepen = parseAgentJson(deepenRaw as string, { tasks_researched: 0, findings_count: 0 })
  log(`Deepen: ${deepen.tasks_researched} tasks, ${deepen.findings_count} findings`)
  await commitPlanFiles([`${epicDir}/TASKS.md`], 'plan: deepen - research findings', 'commit-deepen')
  const deepenGateSteps = gateSteps('deepen', '')
  const deepenGate = parseGateResult(await runBatch(deepenGateSteps, stageOpts('cli', { label: 'gate-deepen', model: model('fast') })))
  if (!deepenGate.passed) throw new Error(`Deepen gate failed — TASKS.md carries no Research Findings after the deepen agent ran: ${deepenGate.message || 'no message'}`)
  log('Deepen gate PASSED')
} else {
  log('Deepen skipped')
}

// Gate
// Deterministic: the verdict is `datum gate`'s exit code read from a batch
// step (shared/gate.ts), not an LLM's echo of its JSON.
const gateStepList = gateSteps('plan', yolo ? ' --approve' : '')
const gate = parseGateResult(await runBatch(gateStepList, stageOpts('cli', { label: 'gate', model: model('fast') })))

if (gate.passed) log('Plan gate PASSED')
else log(`Plan gate: ${gate.message || 'needs approval'}${gate.needsHuman ? ' (needs human approval)' : ''}${gate.hardStop ? ' (hard stop)' : ''}`)

// Publish lane-plan tasks as tracker issues (after gate passes)
let epicIssue: string | undefined
if (gate.passed) {
  const published = await publishLanePlan(`${epicDir}/lane-plan.json`, `[epic] ${ctx.branch}`)
  if (published) {
    epicIssue = published.epicId
    log(`Published ${Object.keys(published.taskIds).length} task issues → epic #${epicIssue}`)
  }
}

export const __workflowResult = {
  branch: ctx.branch, epicDir, approach: chosen?.name,
  taskCount: tasks.length,
  tasks: tasks.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
  gatePassed: gate.passed, gateMessage: gate.message, gateNeedsHuman: gate.needsHuman,
}
