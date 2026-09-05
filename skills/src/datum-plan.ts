import { renderPrompt, parseAgentJson, parseAgentJsonStrict, assertAcyclicTasks, buildContextFilesSection } from './shared/utils'
import { model, DEFAULT_CONFIG } from './shared/models'
import { publishLanePlan } from './shared/tracker'
import { stageOpts, bootstrapOpts, configureAgentTypes, readAgentTypeConfig } from './shared/agent-types'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout, type BatchResult } from './shared/batch'
import { contextProbeSteps, contextRelayPlan, contextInlineSteps, contextFromRelay, contextSlot, contextWitnessInstruction, contextWitnessWrapInstruction, unwrapWitnessedArray, assertReadWitness, type ContextFile } from './shared/context-relay'
import { configReadSteps, configFromSteps } from './shared/config-steps'
import type { PhaseArgs } from './shared/types'
import planApproachesTemplate from './prompts/plan-approaches.md'
import planImpactTemplate from './prompts/plan-impact.md'
import planTriageTemplate from './prompts/plan-triage.md'
import planDeepenTemplate from './prompts/plan-deepen.md'
import { gateSteps, parseGateResult } from './shared/gate'

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
if (relayPlan.inline.length > 0) {
  const inlineSteps = contextInlineSteps(relayPlan.inline)
  inlineBatch = parseBatchResult(
    await agent(batchCommandPrompt(inlineSteps), bootstrapOpts('cli', { label: 'read-context-files', model: model('fast') })),
    inlineSteps,
  )
}
const ctx = contextFromRelay(readBatch, inlineBatch, relayPlan)
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
  if (cfPlan.inline.length > 0) {
    const cfInlineSteps = contextInlineSteps(cfPlan.inline)
    cfInline = parseBatchResult(
      await agent(batchCommandPrompt(cfInlineSteps), stageOpts('cli', { label: 'read-context-files', model: model('fast') })),
      cfInlineSteps,
    )
  }
  const cf = contextFromRelay(cfProbe, cfInline, cfPlan)
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
const buildRaw = await agent(
  `Do these steps in order:
1. mkdir -p "${epicDir}"
2. Write this JSON to "${epicDir}/tasks.json": ${tasksJson}
3. Run: datum lane-plan --input "${epicDir}/tasks.json" --output "${epicDir}/lane-plan.json" --md-output "${epicDir}/TASKS.md"
Do NOT git add or git commit anything in this step.
If step 2 or step 3 fails (non-zero exit), return JSON: {"exit_code": <the exit code>, "error": "<the stdout+stderr of the failing step>"}
Otherwise return: {"exit_code": 0}
Output raw JSON only.`,
  { label: 'build-lane-plan', model: model('fast') },
)
// Safe: the fallback defaults to exit_code 1 (failure), the opposite
// direction of a silent pass — an unparseable result is treated as the plan
// build having failed, not succeeded, and the throw below already catches it.
const build = typeof buildRaw === 'string'
  ? parseAgentJson(buildRaw as string, { exit_code: 1, error: 'build-lane-plan agent returned unparseable output' } as { exit_code: number; error?: string })
  : (buildRaw as { exit_code: number; error?: string })
if (!build || build.exit_code !== 0) {
  throw new Error(`datum lane-plan failed (exit ${build?.exit_code ?? '?'}) — plan NOT committed: ${build?.error || 'no error output'}`)
}

// ── Early plan gate: schema + structure, right after lane-plan and BEFORE the
// skeleton/deepen phases (#352). `--approve` skips only the human-approval
// hold; every structural check (lane-plan schema, topological order, file
// overlap, assumption audit) still runs. The human hold is re-checked by the
// final gate at the end of Triage.
const earlyGateSteps = gateSteps('plan', ' --approve')
const earlyGate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(earlyGateSteps), stageOpts('cli', { label: 'gate-early', model: model('fast') })),
  earlyGateSteps,
))
if (!earlyGate.passed) {
  throw new Error(`Plan gate failed right after datum lane-plan — plan NOT committed (fix tasks.json and re-run datum plan): ${earlyGate.message || 'no message'}`)
}
log('Early plan gate PASSED (schema + structure)')

await agent(
  `Commit the plan artifacts: git add "${epicDir}/tasks.json" "${epicDir}/lane-plan.json" "${epicDir}/TASKS.md" && git commit -m "plan: tasks.json + lane-plan.json + TASKS.md"
Return JSON: {"exit_code": 0} on success, or {"exit_code": 1, "error": "the stderr"} on failure. Output raw JSON only.`,
  stageOpts('cli', { label: 'commit-lane-plan', model: model('fast') }),
)
log('Lane plan built, gated, and committed')

// ── Skeleton batch — generate test contracts while Claude still has full spec context ──
const skeletonDir = `${epicDir}/skeletons`
await agent(
  `Run these commands in order:
1. mkdir -p "${skeletonDir}"
2. datum skeleton --batch --language ${language} --tasks "${epicDir}/lane-plan.json" --output-dir "${skeletonDir}"
3. git add "${skeletonDir}" && git commit -m "plan: pre-generate RED skeletons"
If step 2 fails, return JSON: {"exit_code": 1, "error": "the stderr"}
Otherwise return: {"exit_code": 0, "skeleton_dir": "${skeletonDir}"}
Output raw JSON only.`,
  stageOpts('cli', { label: 'skeleton-batch', model: model('fast') }),
)
log(`Skeletons pre-generated in ${skeletonDir}`)

// ── Triage + Deepen + Gate (collapsed: triage writes routing.json, deepen appends + rebuilds, gate runs) ──

phase('Triage')

// Triage (also writes routing.json and commits — collapsed write-routing)
const triageRaw = await agent(
  planTriageTemplate + `

ADDITIONAL TASK: After deciding, write your decision as JSON to ".datum/routing.json" and commit:
git add .datum/routing.json && git commit -m "plan: triage decision"`,
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

// Deepen (conditional — also rebuilds lane-plan and commits)
if (triage.decision === 'deepen') {
  const deepenRaw = await agent(
    planDeepenTemplate + `

ADDITIONAL TASK after appending Research Findings:
1. Run: datum lane-plan --input "${epicDir}/tasks.json" --output "${epicDir}/lane-plan.json" --md-output "${epicDir}/TASKS.md"
2. Commit: git add "${epicDir}/TASKS.md" "${epicDir}/lane-plan.json" && git commit -m "plan: deepen + rebuild"
Return JSON: {"tasks_researched": N, "findings_count": N}`,
    { label: 'deepen-research', model: model('balanced') },
  )
  // Safe: pure telemetry — these counts are only logged, never used to
  // decide anything (the lane-plan rebuild and commit already ran inside
  // the agent's own prompt above, independent of this parse).
  const deepen = parseAgentJson(deepenRaw as string, { tasks_researched: 0, findings_count: 0 })
  log(`Deepen: ${deepen.tasks_researched} tasks, ${deepen.findings_count} findings`)
} else {
  log('Deepen skipped')
}

// Gate
// Deterministic: the verdict is `datum gate`'s exit code read from a batch
// step (shared/gate.ts), not an LLM's echo of its JSON.
const gateStepList = gateSteps('plan', yolo ? ' --approve' : '')
const gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts('cli', { label: 'gate', model: model('fast') })),
  gateStepList,
))

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
