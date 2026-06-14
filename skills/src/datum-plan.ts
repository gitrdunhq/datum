import { renderPrompt, parseAgentJson } from './shared/utils'
import planApproachesTemplate from './prompts/plan-approaches.md'
import planDecomposeTemplate from './prompts/plan-decompose.md'
import planImpactTemplate from './prompts/plan-impact.md'
import planTriageTemplate from './prompts/plan-triage.md'
import planDeepenTemplate from './prompts/plan-deepen.md'

export const meta = {
  name: 'datum-plan',
  description: 'Decompose SPEC.md into tasks.json + lane-plan.json — approach, impact, decompose, triage, deepen',
  phases: [
    { title: 'Read', detail: 'read SPEC.md, CURRENT_STATE.md, prior failures' },
    { title: 'Approach', detail: 'propose 2-3 approaches, pick simplest in yolo mode' },
    { title: 'Impact', detail: 'blast radius analysis on affected files' },
    { title: 'Decompose', detail: 'break SPEC into tasks with ACs, files, deps, RED notes' },
    { title: 'Build', detail: 'write tasks.json, run datum lane-plan, commit artifacts' },
    { title: 'Triage', detail: 'evaluate plan complexity — route to deepen or skip' },
    { title: 'Deepen', detail: 'gather codebase evidence for complex tasks (conditional)' },
    { title: 'Gate', detail: 'run datum gate plan' },
  ],
}

// ── Parse args ──

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})

const yolo: boolean = !!a.yolo

// ── Read ──

phase('Read')

const context = await agent(
  `Run these commands and return ONLY a JSON object:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
3. Read docs/epics/<branch>/SPEC.md — return full contents as "spec_content"
4. Read CURRENT_STATE.md if it exists — return first 80 lines as "current_state", else null
5. Run: jq -r '.brief_defects[]? | "\\(.surfaced_by_stage)\\t\\(.missing_ac)"' .datum/runs/*/closeout-data.json 2>/dev/null — return as "prior_defects" string, empty if none
6. Read .datum/ERRORS.md if it exists — return first 40 lines as "error_history", else null
Output raw JSON only. No markdown fences.`,
  { label: 'read-context', model: 'sonnet' },
)

const ctx = typeof context === 'string'
  ? parseAgentJson(context as string, {} as Record<string, unknown>)
  : context

const epicDir: string = ctx.epic_dir || `docs/epics/${ctx.branch || 'unknown'}`
const specContent: string = ctx.spec_content || ''

if (!specContent) {
  throw new Error(`SPEC.md not found at ${epicDir}/SPEC.md. Run datum-refine first.`)
}

log(`Branch: ${ctx.branch}, SPEC: ${specContent.split('\n').length} lines`)

const priorFailures: string = [
  ctx.prior_defects || '',
  ctx.error_history || '',
].filter(Boolean).join('\n') || '(no prior failure data)'

// ── Approach ──

phase('Approach')

const approachesRaw = await agent(
  renderPrompt(planApproachesTemplate, {
    specContent,
    currentState: ctx.current_state || '(not available)',
  }),
  { label: 'propose-approaches', model: 'sonnet' },
)

interface Approach {
  name: string
  description: string
  tradeoffs: string
  modules_touched: string[]
  estimated_tasks: number
  blast_radius: string
}

interface ApproachResult {
  approaches: Approach[]
  recommended: number
  recommendation_reason: string
}

const approaches: ApproachResult = typeof approachesRaw === 'string'
  ? parseAgentJson(approachesRaw as string, { approaches: [], recommended: 0, recommendation_reason: '' } as ApproachResult)
  : approachesRaw as ApproachResult

for (let i = 0; i < approaches.approaches.length; i++) {
  const ap = approaches.approaches[i]
  const marker = i === approaches.recommended ? ' ← recommended' : ''
  log(`Approach ${i}: ${ap.name} — ~${ap.estimated_tasks} tasks, ${ap.blast_radius} risk${marker}`)
}

const chosen: Approach = approaches.approaches[approaches.recommended] || approaches.approaches[0]
log(`Selected: ${chosen.name} — ${approaches.recommendation_reason}`)

// ── Impact ──

phase('Impact')

const allFiles: string[] = chosen.modules_touched || []
const filesList: string = allFiles.length > 0 ? allFiles.join('\n') : specContent

const impactRaw = await agent(
  renderPrompt(planImpactTemplate, { wt: '.', filesList }),
  { label: 'impact-analysis', model: 'sonnet' },
)

const impactStr: string = typeof impactRaw === 'string' ? impactRaw : JSON.stringify(impactRaw)
log('Impact analysis complete')

// ── Decompose ──

phase('Decompose')

// Escalate to opus for complex epics: high blast radius, many files, or System-tier classification
const isComplex: boolean = chosen.blast_radius === 'high'
  || (chosen.estimated_tasks || 0) > 5
  || specContent.includes('clusters_touched: ')
    && parseInt(specContent.match(/clusters_touched:\s*(\d+)/)?.[1] || '0') > 3
const decomposeModel = isComplex ? 'opus' as const : 'sonnet' as const
if (isComplex) log('Complex epic detected — using opus for decomposition')

const tasksRaw = await agent(
  renderPrompt(planDecomposeTemplate, {
    specContent,
    chosenApproach: JSON.stringify(chosen),
    scanContext: impactStr,
    priorFailures,
  }),
  { label: 'decompose-tasks', model: decomposeModel },
)

const tasks = typeof tasksRaw === 'string'
  ? parseAgentJson(tasksRaw as string, [] as Record<string, unknown>[])
  : tasksRaw

const tasksJson: string = JSON.stringify(tasks)
log(`Decomposed into ${tasks.length} tasks`)

for (const task of tasks) {
  const deps = task.depends_on?.length > 0 ? ` (depends: ${task.depends_on.join(', ')})` : ''
  log(`  ${task.id}: ${task.title}${deps}`)
}

// ── Build ──

phase('Build')

// Write tasks.json
await agent(
  `Write this JSON to "tasks.json" in the repo root. Create the file if it doesn't exist.
Then commit: git add tasks.json && git commit -m "plan: write tasks.json"

JSON CONTENT:
${tasksJson}`,
  { label: 'write-tasks-json', model: 'haiku' },
)

// Run datum lane-plan to produce lane-plan.json + TASKS.md
const lanePlanResult = await agent(
  `Run these commands in sequence:
1. datum lane-plan --input tasks.json --output .datum/lane-plan.json --md-output TASKS.md
2. Copy artifacts to epic dir:
   mkdir -p "${epicDir}"
   cp TASKS.md "${epicDir}/TASKS.md"
   cp tasks.json "${epicDir}/tasks.json"
3. Commit: git add TASKS.md tasks.json .datum/lane-plan.json "${epicDir}/TASKS.md" "${epicDir}/tasks.json" && git commit -m "plan: build lane-plan.json + TASKS.md"
4. Return the exit code from step 1 as JSON: {"exit_code": N, "error": "stderr if any"}
Output raw JSON only.`,
  { label: 'build-lane-plan', model: 'haiku' },
)

const lpResult = typeof lanePlanResult === 'string'
  ? parseAgentJson(lanePlanResult as string, { exit_code: 1, error: 'parse failure' })
  : lanePlanResult

if (lpResult?.exit_code && lpResult.exit_code !== 0) {
  log(`lane-plan failed: ${lpResult.error || 'unknown'}`)
  throw new Error(`datum lane-plan failed: ${lpResult.error}`)
}

log('tasks.json + lane-plan.json + TASKS.md written and committed')

// ── Triage ──

phase('Triage')

interface TriageDecision {
  decision: string
  reason: string
  triggers: string[]
}

const triageRaw = await agent(
  planTriageTemplate,
  { label: 'triage-decision', model: 'haiku' },
)

const triage: TriageDecision = typeof triageRaw === 'string'
  ? parseAgentJson(triageRaw as string, { decision: 'skip', reason: 'parse failure', triggers: [] } as TriageDecision)
  : triageRaw as TriageDecision

// Write routing decision
await agent(
  `Write this JSON to ".datum/routing.json":
${JSON.stringify(triage, null, 2)}
Then commit: git add .datum/routing.json && git commit -m "plan: triage — ${triage.decision}"`,
  { label: 'write-routing', model: 'haiku' },
)

log(`Triage: ${triage.decision} — ${triage.reason}`)
if (triage.triggers?.length > 0) {
  log(`  triggers: ${triage.triggers.join(', ')}`)
}

// ── Deepen (conditional) ──

if (triage.decision === 'deepen') {
  phase('Deepen')

  const deepenRaw = await agent(
    planDeepenTemplate,
    { label: 'deepen-research', model: 'sonnet' },
  )

  const deepen = typeof deepenRaw === 'string'
    ? parseAgentJson(deepenRaw as string, { tasks_researched: 0, findings_count: 0 })
    : deepenRaw

  log(`Deepen: researched ${deepen?.tasks_researched || '?'} tasks, ${deepen?.findings_count || '?'} findings`)

  // Rebuild lane-plan after deepen appended to TASKS.md
  await agent(
    `Run: datum lane-plan --input tasks.json --output .datum/lane-plan.json --md-output TASKS.md
Copy updated TASKS.md: cp TASKS.md "${epicDir}/TASKS.md"
Commit: git add TASKS.md .datum/lane-plan.json "${epicDir}/TASKS.md" && git commit -m "plan: rebuild after deepen"
Return JSON: {"exit_code": 0}`,
    { label: 'rebuild-after-deepen', model: 'haiku' },
  )
} else {
  log('Deepen skipped — plan is straightforward')
}

// ── Gate ──

phase('Gate')

const gateFlag: string = yolo ? ' --approve' : ''
const gateResult = await agent(
  `Run: datum gate plan${gateFlag}
Return the JSON output from the gate command. If the gate fails, return the failure JSON as-is.
Output raw JSON only.`,
  { label: 'gate-plan', model: 'haiku' },
)

const gate = typeof gateResult === 'string'
  ? parseAgentJson(gateResult as string, { passed: false, message: 'parse failure' })
  : gateResult

if (gate?.passed) {
  log('Plan gate PASSED')
} else {
  log(`Plan gate: ${gate?.message || 'needs human approval'}`)
}

export const __workflowResult = {
  branch: ctx.branch,
  epicDir,
  approach: chosen.name,
  taskCount: tasks.length,
  tasks: tasks.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
  gatePassed: !!gate?.passed,
  gateMessage: gate?.message || '',
}
