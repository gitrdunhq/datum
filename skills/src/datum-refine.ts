import { renderPrompt } from './shared/utils'
import refineTriageTemplate from './prompts/refine-triage.md'
import refineClassifyTemplate from './prompts/refine-classify.md'
import refineScanTemplate from './prompts/refine-scan.md'
import refineSpecTemplate from './prompts/refine-spec.md'
import refineQuestionsTemplate from './prompts/refine-questions.md'

export const meta = {
  name: 'datum-refine',
  description: 'Transform TICKET.md into SPEC.md — triage addenda, classify ambiguity, scan codebase, write spec',
  phases: [
    { title: 'Read', detail: 'read TICKET.md and detect branch/epic dir' },
    { title: 'Triage', detail: 'classify addenda as same-scope vs roadmap' },
    { title: 'Classify', detail: 'determine ambiguity level (high/medium/low/trivial)' },
    { title: 'Scan', detail: 'verify referenced symbols and discover codebase patterns' },
    { title: 'Write', detail: 'produce SPEC.md + QUESTIONS.md' },
    { title: 'Gate', detail: 'run datum gate refine' },
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

const branchInfo = await agent(
  `Run these commands and return ONLY a JSON object:
1. "branch": output of \`git rev-parse --abbrev-ref HEAD\`
2. "epic_dir": "docs/epics/" + the branch name
3. "ticket_exists": whether the file docs/epics/<branch>/TICKET.md exists (true/false)
4. "spec_exists": whether docs/epics/<branch>/SPEC.md exists (true/false)
5. "current_state": read CURRENT_STATE.md if it exists (first 50 lines), else null
Output raw JSON only. No markdown fences.`,
  { label: 'read-context', model: 'haiku' },
)

const ctx = typeof branchInfo === 'string'
  ? JSON.parse(branchInfo.replace(/```[a-z]*\n?/g, '').trim())
  : branchInfo

const epicDir: string = ctx.epic_dir || `docs/epics/${ctx.branch || 'unknown'}`
const ticketPath: string = `${epicDir}/TICKET.md`

if (!ctx.ticket_exists) {
  throw new Error(`TICKET.md not found at ${ticketPath}. Run \`datum init\` first.`)
}

log(`Branch: ${ctx.branch}, Epic dir: ${epicDir}`)

const ticketContent: string = await agent(
  `Read the file "${ticketPath}" and return its full contents as plain text. No JSON, no wrapping.`,
  { label: 'read-ticket', model: 'haiku' },
) as string

log(`TICKET.md: ${ticketContent.split('\n').length} lines`)

// ── Triage addenda ──

phase('Triage')

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
  const triageRaw = await agent(
    renderPrompt(refineTriageTemplate, { ticketPath }),
    { label: 'triage-addenda', model: 'sonnet' },
  )
  triageResult = typeof triageRaw === 'string'
    ? JSON.parse(triageRaw.replace(/```[a-z]*\n?/g, '').trim())
    : triageRaw as TriageResult

  if (triageResult.roadmap_items?.length > 0) {
    log(`Triaged to roadmap: ${triageResult.roadmap_items.join(', ')}`)
    await agent(
      `Append these items to ROADMAP.md under "## Planned":
${triageResult.roadmap_items.map((item: string) => `- ${item}`).join('\n')}

Read ROADMAP.md first, append under the Planned section, write it back. Commit: git add ROADMAP.md && git commit -m "roadmap: triage ${triageResult.roadmap_items.length} items from refine"`,
      { label: 'update-roadmap', model: 'haiku' },
    )
  }
  log(`Triage: ${triageResult.addenda.length} addenda, ${triageResult.roadmap_items.length} roadmapped`)
} else {
  log('No addenda found — single-scope TICKET')
}

// ── Classify ambiguity ──

phase('Classify')

interface ClassifyResult {
  level: string
  reasoning: string
  gaps: string[]
  assumptions: string[]
}

const classifyRaw = await agent(
  renderPrompt(refineClassifyTemplate, { ticketContent }),
  { label: 'classify-ambiguity', model: 'haiku' },
)

const classify: ClassifyResult = typeof classifyRaw === 'string'
  ? JSON.parse(classifyRaw.replace(/```[a-z]*\n?/g, '').trim())
  : classifyRaw as ClassifyResult

log(`Ambiguity: ${classify.level} — ${classify.reasoning}`)
if (classify.gaps.length > 0) {
  log(`Gaps: ${classify.gaps.join('; ')}`)
}

// ── Scan codebase ──

phase('Scan')

const requirements: string = triageResult.merged_requirements.length > 0
  ? triageResult.merged_requirements.join('\n')
  : ticketContent

const scanRaw = await agent(
  renderPrompt(refineScanTemplate, { wt: '.', requirements }),
  { label: 'scan-codebase', model: 'sonnet' },
)

const scanResults: string = typeof scanRaw === 'string' ? scanRaw : JSON.stringify(scanRaw)
log(`Scan complete`)

// ── Write SPEC + QUESTIONS ──

phase('Write')

const specContent: string = await agent(
  renderPrompt(refineSpecTemplate, {
    ticketContent,
    scanResults,
    ambiguityLevel: classify.level,
    gaps: classify.gaps.join('\n'),
    assumptions: classify.assumptions.join('\n'),
  }),
  { label: 'write-spec', model: 'sonnet' },
) as string

const specPath = `${epicDir}/SPEC.md`
await agent(
  `Write this content to "${specPath}" (create parent dirs if needed), then commit:
git add "${specPath}" && git commit -m "refine: write SPEC.md"

CONTENT TO WRITE:
${specContent}`,
  { label: 'commit-spec', model: 'haiku' },
)
log(`SPEC.md written to ${specPath}`)

// Write QUESTIONS.md if there are gaps
const questionsPath = `${epicDir}/QUESTIONS.md`
const today = await agent(
  'Run `date +%Y-%m-%d` and return ONLY the date string. No explanation.',
  { label: 'get-date', model: 'haiku' },
) as string

const questionsContent: string = await agent(
  renderPrompt(refineQuestionsTemplate, {
    gaps: classify.gaps.join('\n'),
    assumptions: classify.assumptions.join('\n'),
    ambiguityLevel: classify.level,
    date: today.trim(),
  }),
  { label: 'write-questions', model: 'sonnet' },
) as string

await agent(
  `Write this content to "${questionsPath}" (create parent dirs if needed), then commit:
git add "${questionsPath}" && git commit -m "refine: write QUESTIONS.md"

CONTENT TO WRITE:
${questionsContent}`,
  { label: 'commit-questions', model: 'haiku' },
)
log(`QUESTIONS.md written to ${questionsPath}`)

// ── Gate ──

phase('Gate')

const gateFlag: string = yolo ? ' --approve' : ''
const gateResult = await agent(
  `Run: datum gate refine${gateFlag}
Return the JSON output from the gate command. If the gate fails, return the failure JSON as-is.
Output raw JSON only.`,
  { label: 'gate-refine', model: 'haiku' },
)

const gate = typeof gateResult === 'string'
  ? JSON.parse(gateResult.replace(/```[a-z]*\n?/g, '').trim())
  : gateResult

if (gate?.passed) {
  log('Refine gate PASSED')
} else {
  log(`Refine gate FAILED: ${gate?.message || 'unknown'}`)
}

export const __workflowResult = {
  branch: ctx.branch,
  epicDir,
  ambiguity: classify.level,
  gaps: classify.gaps,
  roadmapItems: triageResult.roadmap_items,
  gatePassed: !!gate?.passed,
  gateMessage: gate?.message || '',
}
