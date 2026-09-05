import { renderPrompt, parseAgentJsonStrict } from './shared/utils'
import { model } from './shared/models'
import refineTriageTemplate from './prompts/refine-triage.md'
import refineClassifyTemplate from './prompts/refine-classify.md'
import refineScanTemplate from './prompts/refine-scan.md'
import refineSpecTemplate from './prompts/refine-spec.md'
import refineQuestionsTemplate from './prompts/refine-questions.md'
import { gateSteps, parseGateResult } from './shared/gate'
import { runBatch } from './shared/agents'
import { batchCommandPrompt, setBatchCacheKey, parseBatchResult, stepStdout, type BatchResult } from './shared/batch'
import { contextProbeSteps, contextRelayPlan, contextInlineSteps, contextFromRelay, contextSlot, contextWitnessInstruction, assertReadWitness } from './shared/context-relay'
import { stageOpts, bootstrapOpts, configureAgentTypes } from './shared/agent-types'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
import { answeredQuestions, answersKeptSteps, answersKeptFromSteps } from './shared/questions-steps'
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
// QUESTIONS.md rides along so a re-run carries answered questions forward
// (operator decisions) instead of regenerating over them.
const QUESTIONS_REL = 'docs/epics/$__eb/QUESTIONS.md'
const probeSteps = contextProbeSteps({
  files: [TICKET_REL, QUESTIONS_REL],
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
const relayPlan = contextRelayPlan(readBatch, [TICKET_REL, QUESTIONS_REL])

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

// ── Early gate: is refine already complete? ────────────────────────────────
// A refused or crashed gate batch on the previous run left the phase
// unrecorded although SPEC.md and an answered QUESTIONS.md were committed;
// the relaunch then regenerated both and threw the operator's answers away
// (elonchesd wf_230050d5-e9e). `--approve` skips only the human hold, every
// structural check still runs; the final gate below re-applies the policy.
const questionsFile = ctx.files[QUESTIONS_REL]
const earlyGateSteps = gateSteps('refine', ' --approve')
const earlyGate = parseGateResult(await runBatch(earlyGateSteps, stageOpts('cli', { label: 'gate-early', model: model('fast') })))
const alreadyComplete: boolean = earlyGate.passed
if (alreadyComplete) {
  log(`refine_already_complete: SPEC.md and QUESTIONS.md in ${epicDir} pass the refine gate — not regenerating (answered questions are operator decisions)`)
}

interface ClassifyResult {
  level: string
  reasoning: string
  gaps: string[]
  assumptions: string[]
}

interface TriageResult {
  original_scope: string
  addenda: Array<{ date: string; summary: string; verdict: string; reason: string }>
  roadmap_items: string[]
  merged_requirements: string[]
}

interface RefineOutcome { classify: ClassifyResult; triageResult: TriageResult }

async function refineFromTicket(): Promise<RefineOutcome> {
// ── Analyze (collapsed: triage + classify + scan run in sequence, no mechanical agents) ──

phase('Analyze')

// Triage addenda (only if addenda exist) — counted by the probe batch, so it
// holds whether or not the TICKET was inlined.
const hasAddenda: boolean = parseInt((stepStdout(readBatch, 'has-addenda') || '0').trim(), 10) > 0

let triageResult: TriageResult = {
  original_scope: '',
  addenda: [],
  roadmap_items: [],
  merged_requirements: [],
}

// Every refine commit goes through a commitFilesSteps batch
// (shared/commit-steps.ts): the exit code is the verdict, the agent that
// wrote the files never commits them, and a failed or empty commit halts
// by name. (An agent that "committed" used to be indistinguishable from
// one that did not — its reply was discarded — and it could copy an
// attribution trailer from the harness reminder into the message.)
async function commitRefineFiles(files: string[], message: string, label: string, opts: { allowUnchanged: boolean } = { allowUnchanged: true }): Promise<string> {
  const commitStepList = commitFilesSteps({ wt: '.', files, message })
  const commit = commitFilesFromSteps(parseBatchResult(
    await agent(batchCommandPrompt(commitStepList), stageOpts('cli', { label, model: model('fast') })),
    commitStepList,
  ))
  if (commit.error) throw new Error(`refine_commit_failed: ${commit.error}`)
  // A missing file fails `git add` (commit.error). Nothing-to-commit means the
  // files already match HEAD: fine for a resume re-writing SPEC.md, a failure
  // for an append the agent was supposed to make (ROADMAP.md, allowUnchanged=false).
  if (commit.nothingToCommit) {
    if (!opts.allowUnchanged) throw new Error(`refine_commit_failed: nothing to commit for ${label} (${files.join(', ')}) — the agent did not write them`)
    log(`${label}: ${files.join(', ')} unchanged since the last run — already committed`)
    return 'unchanged'
  }
  return commit.sha
}

if (hasAddenda) {
  // Triage agent also updates ROADMAP.md if needed (collapsed update-roadmap);
  // the script commits it below.
  const triageRaw = await agent(
    renderPrompt(refineTriageTemplate, { ticketPath }) + `

ADDITIONAL TASK: If any addenda are triaged as "roadmap" (different feature), also:
1. Read ROADMAP.md
2. Append the roadmap items under "## Planned"
Do NOT git add or git commit anything — the workflow commits ROADMAP.md after you return.`,
    { label: 'triage-addenda', model: model('balanced') },
  )
  // Strict: hasAddenda is true here, so a silent fallback to "no addenda"
  // would drop real TICKET.md addenda from SPEC.md without any trace —
  // merged_requirements falls back to the raw ticketContent below, under-
  // scoping the spec with no warning. An unparseable response must halt the
  // phase instead.
  triageResult = parseAgentJsonStrict<TriageResult>(triageRaw as string, 'triage-addenda')
  log(`Triage: ${triageResult.addenda.length} addenda, ${triageResult.roadmap_items.length} roadmapped`)
  if (triageResult.roadmap_items.length > 0) {
    // Roadmapped addenda mean ROADMAP.md must have changed; nothing to
    // commit is the agent having skipped the append, not a clean outcome.
    const roadmapCommit = await commitRefineFiles(['ROADMAP.md'], 'roadmap: triage items from refine', 'commit-roadmap', { allowUnchanged: false })
    log(`ROADMAP.md committed (${roadmapCommit})`)
  }
} else {
  log('No addenda — single-scope TICKET')
}

// Classify ambiguity
// FLOW.md open gap 2: nothing verified that a deferred ticketContent (over
// the relay budget) was actually read rather than skipped. contextWitnessInstruction
// is '' when TICKET.md was inlined, so this is a no-op prompt change in the
// common case; when deferred, it demands a git-hash-object witness in the
// agent's JSON output, and assertReadWitness gates it below.
const classifyRaw = await agent(
  renderPrompt(refineClassifyTemplate, { ticketContent }) + contextWitnessInstruction([ticketFile]),
  { label: 'classify-ambiguity', model: model('fast') },
)

// Strict: silently defaulting to a 'medium' ambiguity classification on an
// unparseable response is exactly the "an LLM proposes; it never asserts"
// violation FLOW.md warns about — SPEC.md/QUESTIONS.md would be written from
// a fabricated classification with no trace it was never actually assessed.
const classify: ClassifyResult = parseAgentJsonStrict<ClassifyResult>(classifyRaw as string, 'classify-ambiguity')
assertReadWitness([ticketFile], classify)
log(`Ambiguity: ${classify.level} — ${classify.reasoning}`)

// Scan codebase
// Not read-witness-gated: scanRaw's output is kept as free-form text
// (scanResults below), never parsed as JSON, so there is no JSON field to
// carry a read_witness in. (write-spec-and-questions further down IS gated:
// it returns a JSON receipt.)
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

// Agent 1: write SPEC + QUESTIONS and return a receipt; the script commits.
// The receipt is where a deferred TICKET.md read is evidenced (FLOW.md gap
// 2): contextWitnessInstruction is '' when TICKET.md was inlined.
const timestamp: string = stepStdout(readBatch, 'timestamp') || ''
const today = timestamp ? timestamp.slice(0, 10) : '(date unavailable)'
const specPath = `${epicDir}/SPEC.md`
const questionsPath = `${epicDir}/QUESTIONS.md`

const specRaw = await agent(
  `You have TWO tasks. Do them in order.

TASK 1 — Write SPEC.md:
${renderPrompt(refineSpecTemplate, {
    ticketContent,
    scanResults,
    ambiguityLevel: classify.level,
    gaps: classify.gaps.join('\n'),
    assumptions: classify.assumptions.join('\n'),
  })}

Write the SPEC to "${specPath}" (create dirs if needed).

TASK 2 — Write QUESTIONS.md:
${renderPrompt(refineQuestionsTemplate, {
    gaps: classify.gaps.join('\n'),
    assumptions: classify.assumptions.join('\n'),
    ambiguityLevel: classify.level,
    date: today,
    existingQuestions: questionsFile.exists ? contextSlot(questionsFile) : '(none)',
  })}

Write the QUESTIONS to "${questionsPath}".

Do NOT git add or git commit anything — the workflow commits both files after you return.
Your response is raw JSON only (no markdown fences, no prose): {"written": ["${specPath}", "${questionsPath}"]}`
  + contextWitnessInstruction([ticketFile]),
  { label: 'write-spec-and-questions', model: model('balanced') },
)

interface SpecReceipt { written: string[]; read_witness?: Record<string, string> }
const spec = parseAgentJsonStrict<SpecReceipt>(specRaw as string, 'write-spec-and-questions')
assertReadWitness([ticketFile], spec)
for (const p of [specPath, questionsPath]) {
  if (!Array.isArray(spec.written) || !spec.written.includes(p)) {
    throw new Error(`refine_write_failed: agent did not report writing ${p} (reported: ${JSON.stringify(spec.written)})`)
  }
}

// Answered questions are operator decisions: the prompt's carry-forward rule
// is a proposal, this is the gate. Every `[Answer]:` line that existed
// before the write must still be in the rewritten file, or the phase halts
// by name BEFORE committing (the files stay in the tree for inspection).
// A QUESTIONS.md over the relay budget was not inlined, so its answers
// cannot be enumerated here; say so rather than pretend the check ran.
if (questionsFile.exists && !questionsFile.inlined) {
  log(`refine_answers_unchecked: ${questionsPath} (${questionsFile.bytes} bytes) was over the relay budget — answered questions could not be verified against the rewrite`)
}
const answered = questionsFile.exists && questionsFile.inlined ? answeredQuestions(questionsFile.content || '') : []
if (answered.length > 0) {
  const keptSteps = answersKeptSteps(questionsPath, answered)
  const kept = answersKeptFromSteps(await runBatch(keptSteps, stageOpts('cli', { label: 'answers-kept', model: model('fast') })), answered)
  if (!kept.ok) throw new Error(kept.error)
  log(`${answered.length} previously answered question(s) carried forward verbatim`)
}

const specCommit = await commitRefineFiles([`${epicDir}/SPEC.md`, `${epicDir}/QUESTIONS.md`], 'refine: write SPEC.md + QUESTIONS.md', 'commit-spec')
log(`SPEC.md + QUESTIONS.md written to ${epicDir} and committed (${specCommit})`)
return { classify, triageResult }
}

const outcome: RefineOutcome | null = alreadyComplete ? null : await refineFromTicket()

// Gate — deterministic: the verdict is `datum gate`'s exit code read from a
// batch step (shared/gate.ts), not an LLM's echo of its JSON. Runs on the
// skip path too: the early gate skipped the human hold, this one applies it.
const gateStepList = gateSteps('refine', yolo ? ' --approve' : '')
const gate = parseGateResult(await runBatch(gateStepList, stageOpts('cli', { label: 'gate', model: model('fast') })))

if (gate.passed) log('Refine gate PASSED')
else log(`Refine gate: ${gate.message || 'needs review'}${gate.needsHuman ? ' (needs human approval)' : ''}${gate.hardStop ? ' (hard stop)' : ''}`)

export const __workflowResult = {
  branch: ctx.branch,
  epicDir,
  ambiguity: outcome ? outcome.classify.level : 'unchanged',
  gaps: outcome ? outcome.classify.gaps : [],
  roadmapItems: outcome ? outcome.triageResult.roadmap_items : [],
  alreadyComplete,
  gatePassed: gate.passed,
  gateMessage: gate.message,
  gateNeedsHuman: gate.needsHuman,
}
