import { renderPrompt, parseAgentJson } from './shared/utils'
import { model } from './shared/models'
import refineTriageTemplate from './prompts/refine-triage.md'
import refineClassifyTemplate from './prompts/refine-classify.md'
import refineScanTemplate from './prompts/refine-scan.md'
import refineSpecTemplate from './prompts/refine-spec.md'
import refineQuestionsTemplate from './prompts/refine-questions.md'
import readContextTemplate from './prompts/util-read-context.md'
import runGateTemplate from './prompts/util-run-gate.md'

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
const a = (typeof args === 'string')
  ? (rawArgs.toLowerCase() === 'yolo' ? { yolo: true } : JSON.parse(args))
  : (args || {})

const yolo: boolean = !!a.yolo

// ── Read (collapsed: read-context + read-ticket into one agent) ──

phase('Read')

const readResult = await agent(
  renderPrompt(readContextTemplate, {
    extraFields: `3. "ticket_exists": whether docs/epics/$(git rev-parse --abbrev-ref HEAD)/TICKET.md exists (true/false)
4. "ticket_content": if ticket_exists, read the full file contents, else null
5. "spec_exists": whether docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md exists (true/false)
6. "current_state": read CURRENT_STATE.md if it exists (first 50 lines), else null
7. "timestamp": output of \`date +%Y-%m-%dT%H:%M:%S\``,
  }),
  { label: 'read-context', model: model('fast') },
)

const ctx = typeof readResult === 'string'
  ? parseAgentJson(readResult as string, {} as Record<string, unknown>)
  : readResult

const epicDir: string = ctx.epic_dir || `docs/epics/${ctx.branch || 'unknown'}`
const ticketPath: string = `${epicDir}/TICKET.md`
const ticketContent: string = ctx.ticket_content || ''

if (!ctx.ticket_exists || !ticketContent) {
  throw new Error(`TICKET.md not found at ${ticketPath}. Run \`datum init\` first.`)
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
const today = ctx.timestamp ? ctx.timestamp.slice(0, 10) : '(date unavailable)'

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

// Agent 2: run gate (collapsed gate-refine — still needs an agent since we can't run bash directly)
const gateResult = await agent(
  renderPrompt(runGateTemplate, { phase: 'refine', flags: yolo ? ' --approve' : '' }),
  { label: 'gate', model: model('fast') },
)

const gate = typeof gateResult === 'string'
  ? parseAgentJson(gateResult as string, { passed: false })
  : gateResult

if (gate?.passed) log('Refine gate PASSED')
else log(`Refine gate: ${gate?.message || 'needs review'}`)

export const __workflowResult = {
  branch: ctx.branch,
  epicDir,
  ambiguity: classify.level,
  gaps: classify.gaps,
  roadmapItems: triageResult.roadmap_items,
  gatePassed: !!gate?.passed,
  gateMessage: gate?.message || '',
}
