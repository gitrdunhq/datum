import { parseAgentJson, renderPrompt } from './shared/utils'
import { model, ROUTE_PHASES, PHASES, SEVERITIES, type Route, type Phase, type Scope, type BranchType, type InputType } from './shared/models'
import routeClassifyTemplate from './prompts/route-classify.md'

export const meta = {
  name: 'datum-route',
  description: 'Smart router: classify input → pick the right pipeline composition',
  phases: [
    { title: 'Classify', detail: 'sonnet reads input + artifacts, determines route and startFrom' },
  ],
}

// ── Parse args ──

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const input: string = rawArgs || 'No input provided — check for TICKET.md'

// ── Gather signals ──

phase('Classify')

const [artifactCheck, gitCheck] = await parallel([
  () => agent(
    'Check which pipeline artifacts exist. Run:\n' +
    'echo "TICKET: $(test -f TICKET.md && echo YES || echo NO)"\n' +
    'echo "SPEC: $(test -f SPEC.md && echo YES || echo NO)"\n' +
    'echo "TASKS: $(test -f TASKS.md && echo YES || echo NO)"\n' +
    'echo "LANE_PLAN: $(test -f .datum/lane-plan.json && echo YES || echo NO)"\n' +
    'echo "PROPERTIES: $(test -f PROPERTIES.md && echo YES || echo NO)"\n' +
    'echo "RUNS: $(ls .datum/runs/ 2>/dev/null | tail -3 || echo NONE)"\n' +
    'Return the raw output only.',
    { label: 'check-artifacts', model: model('fast') },
  ),
  () => agent(
    'Run these commands and return the raw output:\n' +
    'git rev-parse --abbrev-ref HEAD\n' +
    'git log --oneline -5\n' +
    'git status --short | head -10',
    { label: 'check-git', model: model('fast') },
  ),
])

// ── Classify with sonnet ──

const ROUTE_SCHEMA = {
  type: 'object' as const,
  properties: {
    route: { type: 'string' as const, enum: ['feature', 'hotfix', 'spike', 'audit', 'resume', 'refine-only'] },
    startFrom: { type: 'string' as const, enum: ['refine', 'plan', 'properties', 'act', 'validate', 'review', 'closeout'] },
    confidence: { type: 'number' as const },
    reasoning: { type: 'string' as const },
    signals: {
      type: 'object' as const,
      properties: {
        intent: { type: 'string' as const },
        scope: { type: 'string' as const, enum: ['narrow', 'moderate', 'broad'] },
        has_spec: { type: 'boolean' as const },
        has_tasks: { type: 'boolean' as const },
        has_lane_plan: { type: 'boolean' as const },
        has_properties: { type: 'boolean' as const },
        branch_type: { type: 'string' as const, enum: ['main', 'feature', 'hotfix'] },
        input_type: { type: 'string' as const, enum: ['ticket', 'bug', 'question', 'audit', 'continuation', 'raw-idea'] },
      },
      required: ['intent', 'scope', 'has_spec', 'has_tasks', 'has_lane_plan', 'has_properties', 'branch_type', 'input_type'],
    },
  },
  required: ['route', 'startFrom', 'confidence', 'reasoning', 'signals'],
}

const classifyPrompt = renderPrompt(routeClassifyTemplate, {
  input,
  artifacts: String(artifactCheck || 'could not check'),
  gitState: String(gitCheck || 'could not check'),
})

const decision = await agent(classifyPrompt, {
  label: 'classify',
  model: model('balanced'),
  schema: ROUTE_SCHEMA,
}) as {
  route: string
  startFrom: string
  confidence: number
  reasoning: string
  signals: Record<string, unknown>
}

if (!decision) throw new Error('Router classification failed — no decision returned')

const confident = decision.confidence >= 0.7
log(`Route: ${decision.route} → start from: ${decision.startFrom} (${Math.round(decision.confidence * 100)}% confidence${confident ? '' : ' — LOW, gates enabled'})`)
log(`Reason: ${decision.reasoning}`)

// ── Log for future model-tier analysis ──
// Write via agent file write (no shell interpolation — avoids injection from LLM-generated content)

const logEntry = JSON.stringify({
  route: decision.route,
  startFrom: decision.startFrom,
  confidence: decision.confidence,
  reasoning: decision.reasoning,
  signals: decision.signals,
  input_length: input.length,
})

await agent(
  `Create directory .datum if it doesn't exist, then APPEND exactly this line to .datum/routing.jsonl:\n${logEntry}\nDo not modify the line. Do not add markdown. Just append it.`,
  { label: 'log-decision', model: model('fast') },
)

// ── Return invocation instructions ──
// datum-route does NOT call datum-go (that would nest workflow() 2 levels)
// Instead it returns the exact args for the caller to invoke datum-go

// Low confidence → enable gates (yolo: false) so human can catch misroutes
const routeKey = decision.route as Route
const invoke = {
  workflow: 'datum-go',
  args: {
    yolo: confident,
    startFrom: decision.startFrom,
    route: decision.route,
    phases: ROUTE_PHASES[routeKey] ? [...ROUTE_PHASES[routeKey]] : [],
  },
}

log(`\nNext: Workflow({ name: "${invoke.workflow}" }, ${JSON.stringify(invoke.args)})`)

export const __workflowResult = {
  route: decision.route,
  startFrom: decision.startFrom,
  confidence: decision.confidence,
  reasoning: decision.reasoning,
  signals: decision.signals,
  invoke,
}
