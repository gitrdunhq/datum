import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
import propertiesDeriveTemplate from './prompts/properties-derive.md'
import readContextTemplate from './prompts/util-read-context.md'
import runGateTemplate from './prompts/util-run-gate.md'

export const meta = {
  name: 'datum-properties',
  description: 'Derive PROPERTIES.md — 11-category invariants with task traceability',
  phases: [
    { title: 'Read', detail: 'read SPEC.md + TASKS.md' },
    { title: 'Derive', detail: 'map requirements to properties, write, commit, gate' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})
const yolo: boolean = !!a.yolo

// ── Read ──

phase('Read')

const context = await agent(
  renderPrompt(readContextTemplate, {
    extraFields: `3. "spec_content": full contents of docs/epics/<branch>/SPEC.md
4. "tasks_content": full contents of TASKS.md`,
  }),
  { label: 'read-context', model: model('fast') },
)

const ctx = typeof context === 'string'
  ? parseAgentJson(context as string, {} as Record<string, unknown>)
  : context

if (!ctx.spec_content) throw new Error('SPEC.md not found. Run datum-refine first.')
if (!ctx.tasks_content) throw new Error('TASKS.md not found. Run datum-plan first.')

log(`Branch: ${ctx.branch}, SPEC: ${ctx.spec_content.split('\n').length} lines`)

// ── Derive + commit + gate (collapsed: derive writes + commits + gates in 2 agents) ──

phase('Derive')

// Derive agent also writes and commits (collapsed commit-properties)
await agent(
  renderPrompt(propertiesDeriveTemplate, { specContent: ctx.spec_content, tasksContent: ctx.tasks_content })
  + `\n\nAFTER WRITING THE PROPERTIES CONTENT:
1. Write the output to "${ctx.epic_dir}/PROPERTIES.md" (create dirs if needed)
2. Also write the same content to "PROPERTIES.md" at repo root
3. Commit: git add "${ctx.epic_dir}/PROPERTIES.md" PROPERTIES.md && git commit -m "properties: derive PROPERTIES.md"`,
  { label: 'derive-and-commit', model: model('balanced') },
)

log('PROPERTIES.md written and committed')

// Gate
const gateResult = await agent(
  renderPrompt(runGateTemplate, { phase: 'properties', flags: yolo ? ' --approve' : '' }),
  { label: 'gate', model: model('fast') },
)
const gate = typeof gateResult === 'string' ? parseAgentJson(gateResult as string, { passed: false }) : gateResult

if (gate?.passed) log('Properties gate PASSED')
else log(`Properties gate: ${gate?.message || 'needs review'}`)

export const __workflowResult = { branch: ctx.branch, gatePassed: !!gate?.passed }
