import { renderPrompt } from './shared/utils'
import { model } from './shared/models'
import propertiesDeriveTemplate from './prompts/properties-derive.md'
import { gateSteps, parseGateResult } from './shared/gate'
import { batchCommandPrompt, parseBatchResult, stepStdout } from './shared/batch'
import { readContextSteps, contextFromSteps } from './shared/lane-steps'
import { stageOpts, bootstrapOpts, configureAgentTypes } from './shared/agent-types'
import type { PhaseArgs } from './shared/types'

export const meta = {
  name: 'datum-properties',
  description: 'Derive PROPERTIES.md — 11-category invariants with task traceability',
  phases: [
    { title: 'Read', detail: 'read SPEC.md + TASKS.md' },
    { title: 'Derive', detail: 'map requirements to properties, write, commit, gate' },
  ],
}

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = ((typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})) as PhaseArgs
const yolo: boolean = !!a.yolo

// ── Read (deterministic batch: branch/epic-dir + byte-verified SPEC.md /
// TASKS.md relay, replacing the LLM `reader` echo of util-read-context.md —
// an LLM echoing a file is lossy (a 90 KB relay came back as 6.7 KB of
// "successful" abridged content in dogfooding), and nothing verified it.
// Mirrors the fix already applied to datum-plan.ts's context_files relay
// (commit a7093d2). ──

// #368: the parent's switches are honoured BEFORE the first agent() call —
// with `agent_types: false` the config read below must not itself go out
// as agentType 'datum-cli'.
if (a.agentTypes && typeof a.agentTypes === 'object') configureAgentTypes(a.agentTypes)

phase('Read')

const SPEC_REL = 'docs/epics/$__eb/SPEC.md'
const TASKS_REL = 'docs/epics/$__eb/TASKS.md'
const readSteps = readContextSteps({
  files: [SPEC_REL, TASKS_REL],
  extraCommands: [
    { name: 'agent-types', command: `jq -r '.agent_types // true' .datum/config.json` },
  ],
})
const readBatch = parseBatchResult(
  await agent(batchCommandPrompt(readSteps), bootstrapOpts('cli', { label: 'read-context', model: model('fast') })),
  readSteps,
)
if (readBatch.missing) {
  throw new Error('context_relay_mismatch: batch agent returned no parseable result for read-context')
}
const ctx = contextFromSteps(readBatch, [SPEC_REL, TASKS_REL])
for (const warning of ctx.warnings) log(`read-context: ${warning}`)

// #368: standalone run (no parent args) — the agent_types field the batch pulled from config.
if (!(a.agentTypes && typeof a.agentTypes === 'object')) {
  const agentTypesRaw = (stepStdout(readBatch, 'agent-types') || '').trim()
  configureAgentTypes({ agentTypes: agentTypesRaw !== 'false' })
}

const specContent: string = ctx.contents[SPEC_REL] || ''
const tasksContent: string = ctx.contents[TASKS_REL] || ''

if (!specContent) throw new Error('SPEC.md not found. Run datum-refine first.')
if (!tasksContent) throw new Error('TASKS.md not found. Run datum-plan first.')

const epicDir: string = ctx.epicDir

log(`Branch: ${ctx.branch}, SPEC: ${specContent.split('\n').length} lines`)

// ── Derive + commit + gate (collapsed: derive writes + commits + gates in 2 agents) ──

phase('Derive')

// Derive agent also writes and commits (collapsed commit-properties)
await agent(
  renderPrompt(propertiesDeriveTemplate, { specContent, tasksContent })
  + `\n\nAFTER WRITING THE PROPERTIES CONTENT:
1. Write the output to "${epicDir}/PROPERTIES.md" (create dirs if needed)
2. Commit: git add "${epicDir}/PROPERTIES.md" && git commit -m "properties: derive PROPERTIES.md"`,
  { label: 'derive-and-commit', model: model('balanced') },
)

log('PROPERTIES.md written and committed')

// Gate
// Deterministic: the verdict is `datum gate`'s exit code read from a batch
// step (shared/gate.ts), not an LLM's echo of its JSON.
const gateStepList = gateSteps('properties', yolo ? ' --approve' : '')
const gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts('cli', { label: 'gate', model: model('fast') })),
  gateStepList,
))

if (gate.passed) log('Properties gate PASSED')
else log(`Properties gate: ${gate.message || 'needs review'}${gate.needsHuman ? ' (needs human approval)' : ''}${gate.hardStop ? ' (hard stop)' : ''}`)

export const __workflowResult = { branch: ctx.branch, gatePassed: gate.passed, gateMessage: gate.message, gateNeedsHuman: gate.needsHuman }
