import { renderPrompt } from './shared/utils'
import propertiesDeriveTemplate from './prompts/properties-derive.md'
import readContextTemplate from './prompts/util-read-context.md'
import commitArtifactTemplate from './prompts/util-commit-artifact.md'
import runGateTemplate from './prompts/util-run-gate.md'

export const meta = {
  name: 'datum-properties',
  description: 'Derive PROPERTIES.md — 11-category invariants with task traceability',
  phases: [
    { title: 'Read', detail: 'read SPEC.md + TASKS.md' },
    { title: 'Derive', detail: 'map requirements to testable properties across 11 categories' },
    { title: 'Gate', detail: 'validate coverage and traceability' },
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
  { label: 'read-inputs', model: 'haiku' },
)

const ctx = typeof context === 'string'
  ? JSON.parse(context.replace(/```[a-z]*\n?/g, '').trim())
  : context

if (!ctx.spec_content) throw new Error('SPEC.md not found. Run datum-refine first.')
if (!ctx.tasks_content) throw new Error('TASKS.md not found. Run datum-plan first.')

log(`Branch: ${ctx.branch}, SPEC: ${ctx.spec_content.split('\n').length} lines, TASKS: ${ctx.tasks_content.split('\n').length} lines`)

// ── Derive ──

phase('Derive')

const propertiesContent: string = await agent(
  renderPrompt(propertiesDeriveTemplate, {
    specContent: ctx.spec_content,
    tasksContent: ctx.tasks_content,
  }),
  { label: 'derive-properties', model: 'sonnet' },
) as string

const propsPath = `${ctx.epic_dir}/PROPERTIES.md`
await agent(
  renderPrompt(commitArtifactTemplate, {
    artifactPath: propsPath,
    extraCommands: 'Also copy to root: write the same content to "PROPERTIES.md".',
    gitAddPaths: `"${propsPath}" PROPERTIES.md`,
    commitMessage: 'properties: derive PROPERTIES.md',
    content: propertiesContent,
  }),
  { label: 'commit-properties', model: 'haiku' },
)

log(`PROPERTIES.md written to ${propsPath} + root`)

// ── Gate ──

phase('Gate')

const gateResult = await agent(
  renderPrompt(runGateTemplate, {
    phase: 'properties',
    flags: yolo ? ' --approve' : '',
  }),
  { label: 'gate-properties', model: 'haiku' },
)

const gate = typeof gateResult === 'string'
  ? JSON.parse(gateResult.replace(/```[a-z]*\n?/g, '').trim())
  : gateResult

if (gate?.passed) log('Properties gate PASSED')
else log(`Properties gate: ${gate?.message || 'needs review'}`)

export const __workflowResult = {
  branch: ctx.branch,
  gatePassed: !!gate?.passed,
}
