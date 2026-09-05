import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
import refineTriageTemplate from './prompts/refine-triage.md'
import refineClassifyTemplate from './prompts/refine-classify.md'
import refineScanTemplate from './prompts/refine-scan.md'
import refineSpecTemplate from './prompts/refine-spec.md'
import refineQuestionsTemplate from './prompts/refine-questions.md'
import { gateSteps, parseGateResult } from './shared/gate'
import { batchCommandPrompt, parseBatchResult, stepStdout } from './shared/batch'
import { readContextSteps, contextFromSteps } from './shared/lane-steps'
import { stageOpts, configureAgentTypes } from './shared/agent-types'
import type { PhaseArgs } from './shared/types'

export const meta = {
  name: 'datum-refine',
  description: 'Transform TICKET.md into SPEC.md — triage addenda, classify ambiguity, scan codebase, write spec',
  phases: [
    { title: 'Read', detail: 'read TICKET.md and detect branch/epic dir' },
    { title: 'Analyze', detail: 'triage addenda + classify ambiguity + scan codebase' },
    { title: 'Write', detail: 'produce SPEC.md + QUESTIONS.md, commit, gate' },
  ],
}

// ── Parse args ──

const rawArgs: string = typeof args === 'string' ? args.trim().replace(/^"|"$/g, '').trim() : ''
const a = ((typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})) as PhaseArgs

const yolo: boolean = !!a.yolo
// #524 dogfooding: forwarded from datum-go so a missing-TICKET.md error can
// tell the caller their issueNumber/freeText was received and ignored,
// rather than throwing a generic "run datum init first" with no trace of
// it. Neither actually bootstraps an epic yet — that's a real gap, not
// something this read implements.
const issueNumber: number | null = typeof a.issueNumber === 'number' ? a.issueNumber : null
const freeText: string = typeof a.freeText === 'string' ? a.freeText : ''

// ── Read (deterministic batch: branch/epic-dir + byte-verified TICKET.md
// relay, replacing the LLM `reader` echo of util-read-context.md — an LLM
// echoing a file is lossy (a 90 KB relay came back as 6.7 KB of "successful"
// abridged content in dogfooding), and nothing verified it. Mirrors the fix
// already applied to datum-plan.ts's context_files relay (commit a7093d2). ──

phase('Read')

const TICKET_REL = 'docs/epics/$__eb/TICKET.md'
const readSteps = readContextSteps({
  files: [TICKET_REL],
  extraCommands: [
    { name: 'timestamp', command: 'date +%Y-%m-%dT%H:%M:%S' },
    { name: 'agent-types', command: `jq -r '.agent_types // true' .datum/config.json` },
  ],
})
const readBatch = parseBatchResult(
  await agent(batchCommandPrompt(readSteps), stageOpts('cli', { label: 'read-context', model: model('fast') })),
  readSteps,
)
if (readBatch.missing) {
  throw new Error('context_relay_mismatch: batch agent returned no parseable result for read-context')
}
const ctx = contextFromSteps(readBatch, [TICKET_REL])
for (const warning of ctx.warnings) log(`read-context: ${warning}`)

// #368: args (from datum-go) win, else the agent_types field the batch pulled from config.
const agentTypesRaw = (stepStdout(readBatch, 'agent-types') || '').trim()
configureAgentTypes(a.agentTypes && typeof a.agentTypes === 'object' ? a.agentTypes : { agentTypes: agentTypesRaw !== 'false' })

const epicDir: string = ctx.epicDir
const ticketPath: string = `${epicDir}/TICKET.md`
const ticketContent: string = ctx.contents[TICKET_REL] || ''

if (!ticketContent) {
  const ignoredInputHint = issueNumber
    ? ` You passed issueNumber ${issueNumber}, but datum-go does not yet bootstrap TICKET.md from a GitHub issue automatically — that input was ignored. Run \`datum ticket-from-issue ${issueNumber}\` to fetch the issue and bootstrap TICKET.md from it, then re-run \`datum go\` with no args.`
    : freeText
      ? ` You passed a brief ("${freeText.slice(0, 80)}${freeText.length > 80 ? '…' : ''}"), but datum-go only uses freeText to detect a NEW epic when one is already in progress on this branch — it does not bootstrap a brand-new epic from freeText when nothing exists yet, so that input was ignored. Run \`datum init --name <slug>\` yourself, fill in TICKET.md with your brief, commit it, then re-run \`datum go\` with no args.`
      : ' Run `datum init` first.'
  throw new Error(`TICKET.md not found at ${ticketPath}.${ignoredInputHint}`)
}

log(`Branch: ${ctx.branch}, TICKET: ${ticketContent.split('\n').length} lines`)

// ── Analyze (collapsed: triage + classify + scan run in sequence, no mechanical agents) ──

phase('Analyze')

// Triage addenda (only if addenda exist)
const hasAddenda: boolean = ticketContent.includes('## Addendum')

interface TriageResult {
  original_scope: string
  addenda: Array<{ date: string; summary: string; verdict: string; reason: string }>
  roadmap_items: string[]
  merged_requirements: string[]
}

let triageResult: TriageResult = {
  original_scope: '',
  addenda: [],
  roadmap_items: [],
  merged_requirements: [],
}

if (hasAddenda) {
  // Triage agent also updates ROADMAP.md if needed (collapsed update-roadmap)
  const triageRaw = await agent(
    renderPrompt(refineTriageTemplate, { ticketPath }) + `

ADDITIONAL TASK: If any addenda are triaged as "roadmap" (different feature), also:
1. Read ROADMAP.md
2. Append the roadmap items under "## Planned"
3. Commit: git add ROADMAP.md && git commit -m "roadmap: triage items from refine"`,
    { label: 'triage-addenda', model: model('balanced') },
  )
  triageResult = parseAgentJson(triageRaw as string, triageResult)
  log(`Triage: ${triageResult.addenda.length} addenda, ${triageResult.roadmap_items.length} roadmapped`)
} else {
  log('No addenda — single-scope TICKET')
}

// Classify ambiguity
const classifyRaw = await agent(
  renderPrompt(refineClassifyTemplate, { ticketContent }),
  { label: 'classify-ambiguity', model: model('fast') },
)

interface ClassifyResult {
  level: string
  reasoning: string
  gaps: string[]
  assumptions: string[]
}

const classify: ClassifyResult = parseAgentJson(classifyRaw as string, { level: 'medium', reasoning: '', gaps: [], assumptions: [] })
log(`Ambiguity: ${classify.level} — ${classify.reasoning}`)

// Scan codebase
const requirements: string = triageResult.merged_requirements.length > 0
  ? triageResult.merged_requirements.join('\n')
  : ticketContent

const scanRaw = await agent(
  renderPrompt(refineScanTemplate, { wt: '.', requirements }),
  { label: 'scan-codebase', model: model('balanced') },
)

const scanResults: string = typeof scanRaw === 'string' ? scanRaw : JSON.stringify(scanRaw)

// ── Write (collapsed: write-spec + commit-spec + write-questions + commit-questions + gate into 2 agents) ──

phase('Write')

// Agent 1: write SPEC + QUESTIONS + commit both
const timestamp: string = stepStdout(readBatch, 'timestamp') || ''
const today = timestamp ? timestamp.slice(0, 10) : '(date unavailable)'

await agent(
  `You have TWO tasks. Do them in order.

TASK 1 — Write SPEC.md:
${renderPrompt(refineSpecTemplate, {
    ticketContent,
    scanResults,
    ambiguityLevel: classify.level,
    gaps: classify.gaps.join('\n'),
    assumptions: classify.assumptions.join('\n'),
  })}

Write the SPEC to "${epicDir}/SPEC.md" (create dirs if needed).

TASK 2 — Write QUESTIONS.md:
${renderPrompt(refineQuestionsTemplate, {
    gaps: classify.gaps.join('\n'),
    assumptions: classify.assumptions.join('\n'),
    ambiguityLevel: classify.level,
    date: today,
  })}

Write the QUESTIONS to "${epicDir}/QUESTIONS.md".

TASK 3 — Commit both:
git add "${epicDir}/SPEC.md" "${epicDir}/QUESTIONS.md" && git commit -m "refine: write SPEC.md + QUESTIONS.md"`,
  { label: 'write-spec-and-questions', model: model('balanced') },
)

log(`SPEC.md + QUESTIONS.md written to ${epicDir}`)

// Gate — deterministic: the verdict is `datum gate`'s exit code read from a
// batch step (shared/gate.ts), not an LLM's echo of its JSON.
const gateStepList = gateSteps('refine', yolo ? ' --approve' : '')
const gate = parseGateResult(parseBatchResult(
  await agent(batchCommandPrompt(gateStepList), stageOpts('cli', { label: 'gate', model: model('fast') })),
  gateStepList,
))

if (gate.passed) log('Refine gate PASSED')
else log(`Refine gate: ${gate.message || 'needs review'}${gate.needsHuman ? ' (needs human approval)' : ''}${gate.hardStop ? ' (hard stop)' : ''}`)

export const __workflowResult = {
  branch: ctx.branch,
  epicDir,
  ambiguity: classify.level,
  gaps: classify.gaps,
  roadmapItems: triageResult.roadmap_items,
  gatePassed: gate.passed,
  gateMessage: gate.message,
  gateNeedsHuman: gate.needsHuman,
}
