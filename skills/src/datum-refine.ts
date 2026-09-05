import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
import refineTriageTemplate from './prompts/refine-triage.md'
import refineClassifyTemplate from './prompts/refine-classify.md'
import refineScanTemplate from './prompts/refine-scan.md'
import refineSpecTemplate from './prompts/refine-spec.md'
import refineQuestionsTemplate from './prompts/refine-questions.md'
import { gateSteps, parseGateResult } from './shared/gate'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout, type BatchResult } from './shared/batch'
import { contextProbeSteps, contextRelayPlan, contextInlineSteps, contextFromRelay, contextSlot } from './shared/context-relay'
import { stageOpts, bootstrapOpts, configureAgentTypes } from './shared/agent-types'
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

// #368: the parent's switches are honoured BEFORE the first agent() call —
// with `agent_types: false` the config read below must not itself go out
// as agentType 'datum-cli' (a dogfooding run died right here).
if (a.agentTypes && typeof a.agentTypes === 'object') configureAgentTypes(a.agentTypes)
// Resume cache key (#354): an answered QUESTIONS.md must re-run the reads and the gate.
setBatchCacheKey(a.configFingerprint || '')

phase('Read')

// Two-phase relay (shared/context-relay.ts): probe sizes first, inline only
// what fits the budget, hand anything larger to the agents by path + hash.
const TICKET_REL = 'docs/epics/$__eb/TICKET.md'
const probeSteps = contextProbeSteps({
  files: [TICKET_REL],
  extraCommands: [
    { name: 'timestamp', command: 'date +%Y-%m-%dT%H:%M:%S' },
    { name: 'agent-types', command: `jq -r '.agent_types // true' .datum/config.json` },
    // Evaluated in the script (below) whether or not the TICKET is inlined.
    { name: 'has-addenda', command: `grep -c '^## Addendum' "docs/epics/$__eb/TICKET.md" 2>/dev/null || true` },
  ],
})
const readBatch = parseBatchResult(
  await agent(batchCommandPrompt(probeSteps), bootstrapOpts('cli', { label: 'read-context', model: model('fast') })),
  probeSteps,
)
const relayPlan = contextRelayPlan(readBatch, [TICKET_REL])

// #368: standalone run (no parent args) — the agent_types field the batch pulled from config.
if (!(a.agentTypes && typeof a.agentTypes === 'object')) {
  const agentTypesRaw = (stepStdout(readBatch, 'agent-types') || '').trim()
  configureAgentTypes({ agentTypes: agentTypesRaw !== 'false' })
}

let inlineBatch: BatchResult | null = null
if (relayPlan.inline.length > 0) {
  const inlineSteps = contextInlineSteps(relayPlan.inline)
  inlineBatch = parseBatchResult(
    await agent(batchCommandPrompt(inlineSteps), stageOpts('cli', { label: 'read-context-files', model: model('fast') })),
    inlineSteps,
  )
}
const ctx = contextFromRelay(readBatch, inlineBatch, relayPlan)
for (const warning of ctx.warnings) log(`read-context: ${warning}`)

const epicDir: string = ctx.epicDir
const ticketPath: string = `${epicDir}/TICKET.md`
const ticketFile = ctx.files[TICKET_REL]

if (!ticketFile.exists) {
  const ignoredInputHint = issueNumber
    ? ` You passed issueNumber ${issueNumber}, but datum-go does not yet bootstrap TICKET.md from a GitHub issue automatically — that input was ignored. Run \`datum ticket-from-issue ${issueNumber}\` to fetch the issue and bootstrap TICKET.md from it, then re-run \`datum go\` with no args.`
    : freeText
      ? ` You passed a brief ("${freeText.slice(0, 80)}${freeText.length > 80 ? '…' : ''}"), but datum-go only uses freeText to detect a NEW epic when one is already in progress on this branch — it does not bootstrap a brand-new epic from freeText when nothing exists yet, so that input was ignored. Run \`datum init --name <slug>\` yourself, fill in TICKET.md with your brief, commit it, then re-run \`datum go\` with no args.`
      : ' Run `datum init` first.'
  throw new Error(`TICKET.md not found at ${ticketPath}.${ignoredInputHint}`)
}

// Either the verified content or a mandatory "Read it with the Read tool"
// instruction (contextSlot) — every prompt slot below takes either.
const ticketContent: string = contextSlot(ticketFile)
log(`Branch: ${ctx.branch}, TICKET: ${ticketFile.bytes} bytes${ticketFile.inlined ? '' : ' (over relay budget — agents read it themselves)'}`)

// ── Analyze (collapsed: triage + classify + scan run in sequence, no mechanical agents) ──

phase('Analyze')

// Triage addenda (only if addenda exist) — counted by the probe batch, so it
// holds whether or not the TICKET was inlined.
const hasAddenda: boolean = parseInt((stepStdout(readBatch, 'has-addenda') || '0').trim(), 10) > 0

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
