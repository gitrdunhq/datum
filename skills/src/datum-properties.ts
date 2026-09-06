import { renderPrompt, parseAgentJsonStrict } from './shared/utils'
import { model } from './shared/models'
import propertiesDeriveTemplate from './prompts/properties-derive.md'
import { gateSteps, parseGateResult } from './shared/gate'
import { runBatch } from './shared/agents'
import { batchCommandPrompt, setBatchCacheKey, setBatchRoot, parseBatchResult, stepStdout, type BatchResult } from './shared/batch'
import { contextProbeSteps, contextRelayPlan, contextInlineSteps, contextInlineRetryPrompt, contextFromRelay, mergeRelayRetry, contextSlot, contextWitnessInstruction, assertReadWitness } from './shared/context-relay'
import { commitFilesSteps, commitFilesFromSteps } from './shared/commit-steps'
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
// Resume cache key (#354): an edited SPEC/TASKS must re-run the reads and the gate.
setBatchCacheKey(a.configFingerprint || '')
setBatchRoot(typeof a.repoRoot === 'string' ? a.repoRoot : '')

phase('Read')

// Two-phase relay (shared/context-relay.ts): probe sizes first, inline only
// what fits the budget, hand anything larger to the agents by path + hash.
const SPEC_REL = 'docs/epics/$__eb/SPEC.md'
const TASKS_REL = 'docs/epics/$__eb/TASKS.md'
const probeSteps = contextProbeSteps({
  files: [SPEC_REL, TASKS_REL],
  extraCommands: [
    { name: 'agent-types', command: `jq -r '.agent_types // true' .datum/config.json` },
  ],
})
const readBatch = parseBatchResult(
  await agent(batchCommandPrompt(probeSteps), bootstrapOpts('cli', { label: 'read-context', model: model('fast') })),
  probeSteps,
)
const relayPlan = contextRelayPlan(readBatch, [SPEC_REL, TASKS_REL])

// #368: standalone run (no parent args) — the agent_types field the batch pulled from config.
if (!(a.agentTypes && typeof a.agentTypes === 'object')) {
  const agentTypesRaw = (stepStdout(readBatch, 'agent-types') || '').trim()
  configureAgentTypes({ agentTypes: agentTypesRaw !== 'false' })
}

let inlineBatch: BatchResult | null = null
const inlineSteps = contextInlineSteps(relayPlan.inline)
if (relayPlan.inline.length > 0) {
  inlineBatch = parseBatchResult(
    await agent(batchCommandPrompt(inlineSteps), stageOpts('cli', { label: 'read-context-files', model: model('fast') })),
    inlineSteps,
  )
}
let ctx = contextFromRelay(readBatch, inlineBatch, relayPlan)
// A relayed file the runner rewrote in transit (caliper eedom
// wf_9bf2c994-801) is re-fetched once with a fresh runner; what still
// mismatches is deferred to the consuming agent, never a halt.
if (ctx.mismatched.length > 0) {
  log(`read-context: context_relay_mismatch on ${ctx.mismatched.join(', ')} — re-fetching once with a fresh runner`)
  const retryBatch = parseBatchResult(
    await agent(contextInlineRetryPrompt(inlineSteps), stageOpts('cli', { label: 'read-context-files:retry', model: model('fast') })),
    inlineSteps,
  )
  ctx = mergeRelayRetry(ctx, contextFromRelay(readBatch, retryBatch, relayPlan))
}
for (const warning of ctx.warnings) log(`read-context: ${warning}`)

const specFile = ctx.files[SPEC_REL]
const tasksFile = ctx.files[TASKS_REL]
if (!specFile.exists) throw new Error('SPEC.md not found. Run datum-refine first.')
if (!tasksFile.exists) throw new Error('TASKS.md not found. Run datum-plan first.')

// Either the verified content or a mandatory "Read it with the Read tool"
// instruction (contextSlot) — the prompt slot takes either.
const specContent: string = contextSlot(specFile)
const tasksContent: string = contextSlot(tasksFile)

const epicDir: string = ctx.epicDir

log(`Branch: ${ctx.branch}, SPEC: ${specFile.bytes} bytes${specFile.inlined ? '' : ' (deferred)'}, TASKS: ${tasksFile.bytes} bytes${tasksFile.inlined ? '' : ' (deferred)'}`)

// ── Derive + commit + gate (collapsed: derive writes + commits + gates in 2 agents) ──

phase('Derive')

// Derive agent writes PROPERTIES.md and returns a JSON receipt; the script
// gates the receipt and commits deterministically.
// Read-witness-gated (FLOW.md open gap 2): the receipt is where a deferred
// specContent/tasksContent read is evidenced (contextWitnessInstruction is
// '' when both were inlined, so the common-case prompt only gains the
// receipt contract). The commit moved out of the agent for the same reason
// docs sync did (800e9dd): a commitFilesSteps batch cannot pick up trailers
// or stray files, and its exit code — not an LLM's say-so — is the verdict.
const propertiesPath = `${epicDir}/PROPERTIES.md`
const deriveRaw = await agent(
  renderPrompt(propertiesDeriveTemplate, { specContent, tasksContent })
  + `\n\nAFTER DERIVING THE PROPERTIES CONTENT:
1. Write the full PROPERTIES.md markdown to "${propertiesPath}" (create dirs if needed).
2. Do NOT git add or git commit anything in this step — the workflow commits.
3. Your response is raw JSON only (no markdown fences, no prose): {"written": "${propertiesPath}"}`
  + contextWitnessInstruction([specFile, tasksFile]),
  { label: 'derive', model: model('balanced') },
)

interface DeriveReceipt { written: string; read_witness?: Record<string, string> }
const derive = parseAgentJsonStrict<DeriveReceipt>(deriveRaw as string, 'derive')
assertReadWitness([specFile, tasksFile], derive)
if (derive.written !== propertiesPath) {
  throw new Error(`properties_derive_failed: agent reported writing ${JSON.stringify(derive.written)}, expected ${propertiesPath}`)
}

const commitStepList = commitFilesSteps({ wt: '.', files: [`${epicDir}/PROPERTIES.md`], message: 'properties: derive PROPERTIES.md' })
const commit = commitFilesFromSteps(parseBatchResult(
  await agent(batchCommandPrompt(commitStepList), stageOpts('cli', { label: 'commit-properties', model: model('fast') })),
  commitStepList,
))
if (commit.error) throw new Error(`properties_commit_failed: ${commit.error}`)
// `git add` of a missing file fails the batch above (commit.error), so
// nothing-to-commit means the file exists and already matches HEAD: a resume
// after derive+commit landed but the gate threw (phase review wf_8a923794-99c).
if (commit.nothingToCommit) log(`PROPERTIES.md unchanged since the last run — already committed at ${propertiesPath}`)
else log(`PROPERTIES.md written and committed (${commit.sha})`)

// Gate
// Deterministic: the verdict is `datum gate`'s exit code read from a batch
// step (shared/gate.ts), not an LLM's echo of its JSON.
const gateStepList = gateSteps('properties', yolo ? ' --approve' : '')
const gate = parseGateResult(await runBatch(gateStepList, stageOpts('cli', { label: 'gate', model: model('fast') })))

if (gate.passed) log('Properties gate PASSED')
else log(`Properties gate: ${gate.message || 'needs review'}${gate.needsHuman ? ' (needs human approval)' : ''}${gate.hardStop ? ' (hard stop)' : ''}`)

export const __workflowResult = { branch: ctx.branch, gatePassed: gate.passed, gateMessage: gate.message, gateNeedsHuman: gate.needsHuman }
