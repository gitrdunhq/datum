import { renderPrompt, parseAgentJson, assertAcyclicTasks, buildContextFilesSection } from './shared/utils'
import { model, READ_CONFIG_PROMPT, DEFAULT_CONFIG } from './shared/models'
import { publishLanePlan } from './shared/tracker'
import { stageOpts, configureAgentTypes, readAgentTypeConfig } from './shared/agent-types'
import planApproachesTemplate from './prompts/plan-approaches.md'
import planImpactTemplate from './prompts/plan-impact.md'
import planTriageTemplate from './prompts/plan-triage.md'
import planDeepenTemplate from './prompts/plan-deepen.md'
import readContextTemplate from './prompts/util-read-context.md'
import runGateTemplate from './prompts/util-run-gate.md'

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
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const yolo: boolean = !!a.yolo

// ── Read (one agent reads everything) ──

phase('Read')

const context = await agent(
  renderPrompt(readContextTemplate, {
    extraFields: `3. "spec_content": full contents of docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md
4. "current_state": read CURRENT_STATE.md if it exists (first 80 lines), else null
5. "prior_defects": run \`jq -r '.brief_defects[]? | "\\(.surfaced_by_stage)\\t\\(.missing_ac)"' .datum/runs/*/closeout-data.json 2>/dev/null\` — return as string, empty if none
6. "error_history": read .datum/ERRORS.md if it exists (first 40 lines), else null`,
  }),
  { label: 'read-context', model: model('balanced') },
)

const ctx = typeof context === 'string'
  ? parseAgentJson(context as string, {} as Record<string, unknown>)
  : context

const epicDir: string = ctx.epic_dir || `docs/epics/${ctx.branch || 'unknown'}`
const specContent: string = ctx.spec_content || ''
if (!specContent) throw new Error(`SPEC.md not found at ${epicDir}/SPEC.md. Run datum-refine first.`)

log(`Branch: ${ctx.branch}, SPEC: ${specContent.split('\n').length} lines`)

const priorFailures: string = [ctx.prior_defects || '', ctx.error_history || ''].filter(Boolean).join('\n') || '(no prior failure data)'

const cfgText = await agent(READ_CONFIG_PROMPT, stageOpts('reader', { label: 'read-config', model: model('fast') }))
const repoCfg = cfgText ? parseAgentJson(cfgText, { ...DEFAULT_CONFIG }) as Record<string, unknown> : { ...DEFAULT_CONFIG }
// #368: args (from datum-go) win, else the repo config, else the defaults.
configureAgentTypes(a.agentTypes && typeof a.agentTypes === 'object' ? a.agentTypes : readAgentTypeConfig(repoCfg))
const language = (repoCfg.language as string) || DEFAULT_CONFIG.language
const testFramework = (repoCfg.test_framework as string) || DEFAULT_CONFIG.test_framework

const contextFilesList: string[] = (repoCfg.context_files as string[] | undefined) || []
const contextFileContents: Record<string, string | null> = {}
for (const relPath of contextFilesList) {
  const raw = await agent(
    `Read the file at path "${relPath}" relative to the project root and return its exact raw contents as plain text, with no commentary, no code fences, and no other text. If the file does not exist, return exactly the string NOT_FOUND with no other text.`,
    stageOpts('reader', { label: `read-context-file:${relPath}`, model: model('fast') }),
  )
  const content = typeof raw === 'string' ? raw : JSON.stringify(raw)
  contextFileContents[relPath] = content.trim() === 'NOT_FOUND' ? null : content
}
const contextFilesWarnings: string[] = []
const contextFilesSection: string = buildContextFilesSection(
  contextFileContents,
  (msg: string) => contextFilesWarnings.push(msg),
)
for (const warning of contextFilesWarnings) log(`context_files: ${warning}`)

import planDecomposeTemplate from './prompts/plan-decompose.md'

// ── Decompose (approach → impact → decompose → build — all substantive, kept separate) ──

phase('Decompose')

// Approach
const approachesRaw = await agent(
  renderPrompt(planApproachesTemplate, { specContent, currentState: ctx.current_state || '(not available)' }),
  { label: 'propose-approaches', model: model('balanced') },
)

interface Approach { name: string; description: string; tradeoffs: string; modules_touched: string[]; estimated_tasks: number; blast_radius: string }
interface ApproachResult { approaches: Approach[]; recommended: number; recommendation_reason: string }

const approaches: ApproachResult = parseAgentJson(approachesRaw as string, { approaches: [], recommended: 0, recommendation_reason: '' } as ApproachResult)
const chosen: Approach = approaches.approaches[approaches.recommended] || approaches.approaches[0]
log(`Selected: ${chosen?.name || 'default'} — ${approaches.recommendation_reason}`)

// Impact
const impactRaw = await agent(
  renderPrompt(planImpactTemplate, { wt: '.', filesList: (chosen?.modules_touched || []).join('\n') || specContent }),
  { label: 'impact-analysis', model: model('balanced') },
)
const impactStr: string = typeof impactRaw === 'string' ? impactRaw : JSON.stringify(impactRaw)

// Decompose (opus for complex)
const isComplex: boolean = (chosen?.blast_radius === 'high') || ((chosen?.estimated_tasks || 0) > 5)
const decomposeModel = isComplex ? model('deep') : model('balanced')
if (isComplex) log('Complex epic — using opus for decomposition')

const tasksRaw = await agent(
  renderPrompt(planDecomposeTemplate, { specContent, chosenApproach: JSON.stringify(chosen), scanContext: impactStr, priorFailures, language, testFramework, contextFilesSection }),
  { label: 'decompose-tasks', model: decomposeModel },
)

const tasks = typeof tasksRaw === 'string' ? parseAgentJson(tasksRaw as string, [] as Record<string, unknown>[]) : tasksRaw
if (!Array.isArray(tasks) || tasks.length === 0) {
  throw new Error(`Task decomposition returned 0 tasks — refusing to write an empty lane plan. Raw output: ${String(tasksRaw).slice(0, 300)}`)
}
assertAcyclicTasks(tasks)
const tasksJson: string = JSON.stringify(tasks)
log(`Decomposed into ${tasks.length} tasks`)
for (const task of tasks) {
  const deps = task.depends_on?.length > 0 ? ` (depends: ${task.depends_on.join(', ')})` : ''
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
const earlyGateResult = await agent(
  renderPrompt(runGateTemplate, { phase: 'plan', flags: ' --approve' }),
  stageOpts('cli', { label: 'gate-early', model: model('fast') }),
)
const earlyGate = typeof earlyGateResult === 'string'
  ? parseAgentJson(earlyGateResult as string, { passed: false, message: 'early gate returned unparseable output' } as { passed: boolean; message?: string })
  : (earlyGateResult as { passed: boolean; message?: string })
if (!earlyGate?.passed) {
  throw new Error(`Plan gate failed right after datum lane-plan — plan NOT committed (fix tasks.json and re-run datum plan): ${earlyGate?.message || 'no message'}`)
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
  const deepen = parseAgentJson(deepenRaw as string, { tasks_researched: 0, findings_count: 0 })
  log(`Deepen: ${deepen.tasks_researched} tasks, ${deepen.findings_count} findings`)
} else {
  log('Deepen skipped')
}

// Gate
const gateResult = await agent(
  renderPrompt(runGateTemplate, { phase: 'plan', flags: yolo ? ' --approve' : '' }),
  stageOpts('cli', { label: 'gate', model: model('fast') }),
)
const gate = typeof gateResult === 'string' ? parseAgentJson(gateResult as string, { passed: false }) : gateResult

if (gate?.passed) log('Plan gate PASSED')
else log(`Plan gate: ${gate?.message || 'needs approval'}`)

// Publish lane-plan tasks as tracker issues (after gate passes)
let epicIssue: string | undefined
if (gate?.passed) {
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
  gatePassed: !!gate?.passed, gateMessage: gate?.message || '',
}
