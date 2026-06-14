import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
import planApproachesTemplate from './prompts/plan-approaches.md'
import planDecomposeTemplate from './prompts/plan-decompose.md'
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
    extraFields: `3. "spec_content": full contents of docs/epics/<branch>/SPEC.md
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
  renderPrompt(planDecomposeTemplate, { specContent, chosenApproach: JSON.stringify(chosen), scanContext: impactStr, priorFailures }),
  { label: 'decompose-tasks', model: decomposeModel },
)

const tasks = typeof tasksRaw === 'string' ? parseAgentJson(tasksRaw as string, [] as Record<string, unknown>[]) : tasksRaw
const tasksJson: string = JSON.stringify(tasks)
log(`Decomposed into ${tasks.length} tasks`)
for (const task of tasks) {
  const deps = task.depends_on?.length > 0 ? ` (depends: ${task.depends_on.join(', ')})` : ''
  log(`  ${task.id}: ${task.title}${deps}`)
}

// Build (collapsed write-tasks-json + build-lane-plan into one agent)
await agent(
  `Do these steps in order:
1. Write this JSON to "tasks.json": ${tasksJson}
2. Run: datum lane-plan --input tasks.json --output .datum/lane-plan.json --md-output TASKS.md
3. Copy to epic dir: mkdir -p "${epicDir}" && cp TASKS.md "${epicDir}/TASKS.md" && cp tasks.json "${epicDir}/tasks.json"
4. Commit: git add TASKS.md tasks.json .datum/lane-plan.json "${epicDir}/TASKS.md" "${epicDir}/tasks.json" && git commit -m "plan: tasks.json + lane-plan.json + TASKS.md"
If step 2 fails, return JSON: {"exit_code": 1, "error": "the stderr"}
Otherwise return: {"exit_code": 0}
Output raw JSON only.`,
  { label: 'build-lane-plan', model: model('fast') },
)
log('Lane plan built and committed')

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
1. Run: datum lane-plan --input tasks.json --output .datum/lane-plan.json --md-output TASKS.md
2. Copy: cp TASKS.md "${epicDir}/TASKS.md"
3. Commit: git add TASKS.md .datum/lane-plan.json "${epicDir}/TASKS.md" && git commit -m "plan: deepen + rebuild"
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
  { label: 'gate', model: model('fast') },
)
const gate = typeof gateResult === 'string' ? parseAgentJson(gateResult as string, { passed: false }) : gateResult

if (gate?.passed) log('Plan gate PASSED')
else log(`Plan gate: ${gate?.message || 'needs approval'}`)

export const __workflowResult = {
  branch: ctx.branch, epicDir, approach: chosen?.name,
  taskCount: tasks.length,
  tasks: tasks.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
  gatePassed: !!gate?.passed, gateMessage: gate?.message || '',
}
