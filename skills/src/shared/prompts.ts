import { model } from './models'
import preambleTemplate from '../prompts/agent-preamble.md'
import redTemplate from '../prompts/red.md'
import redRetryTemplate from '../prompts/red-retry.md'
import greenTemplate from '../prompts/green.md'
import greenRetryTemplate from '../prompts/green-retry.md'
import refactorTemplate from '../prompts/refactor.md'
import structuralTemplate from '../prompts/structural.md'
import reflectTemplate from '../prompts/reflect.md'
import skepticBaseTemplate from '../prompts/skeptic-base.md'
import skepticEdgeTemplate from '../prompts/skeptic-edge.md'
import skepticErrorTemplate from '../prompts/skeptic-error.md'
import skepticContractTemplate from '../prompts/skeptic-contract.md'
import refactorCheckTemplate from '../prompts/refactor-check.md'
import docsCheckTemplate from '../prompts/docs-check.md'
import docsSyncTemplate from '../prompts/docs-sync.md'
import laneStateReadTemplate from '../prompts/lane-state-read.md'
import laneStateWriteTemplate from '../prompts/lane-state-write.md'
import { renderPrompt } from './utils'
import type { SkepticLens } from './types'
import { fencedScript } from './lane-steps'
import { contextSlot, contextWitnessInstruction, type ContextFile } from './context-relay'

const PREAMBLE = preambleTemplate + '\n\n---\n\n'

type PromptVars = { [key: string]: string }

/**
 * Prepend the shared rule header to a prompt built outside this module.
 *
 * The lane and docs helpers below already do this; the Refine, Plan,
 * Properties, Review, Validate, Closeout and Awake scripts render their
 * templates themselves and used to send them bare, so the SPEC writer, the
 * four review lenses and the pipeline's final correctness call never saw
 * "test command comes from `.datum/config.json` — read it, don't guess"
 * (prompts audit 20260906). It is also the largest stable prefix in the
 * pipeline, and it belongs first in every one of them.
 */
export function withPreamble(text: string): string {
  return PREAMBLE + text
}

/**
 * Render a stage template whose criteria live in the exported lane-spec
 * file: `{{laneSpecSlot}}` becomes the mandatory Read instruction for that
 * file and the read-witness paragraph is appended, so the agent's JSON must
 * carry the file's blob-sha prefix (verified by assertReadWitness).
 */
function withLaneSpec(template: string, vars: PromptVars, laneSpec: ContextFile): string {
  return PREAMBLE + renderPrompt(template, { ...vars, laneSpecSlot: contextSlot(laneSpec) }) + contextWitnessInstruction([laneSpec])
}

export function redPrompt(vars: {
  wt: string; skeletonCmd: string; redCtxCmd: string; redPacketStr: string
  testCommand: string; testRunCmd: string; testFilesList: string; commitPrefix: string; commitCmd: string
  testFuncPattern?: string
  /** Integration lanes only (#485): names the invariants the lane covers and
   *  states the tests must PASS (the code under test is already merged). '' for
   *  every other lane — {{integrationNote}} then renders as an empty line. */
  integrationNote?: string
  laneSpec: ContextFile
}): string {
  const { laneSpec, integrationNote, ...rest } = vars
  return withLaneSpec(redTemplate, { ...rest, integrationNote: integrationNote ?? '' } as PromptVars, laneSpec)
}

export function redRetryPrompt(vars: {
  wt: string; failureReason: string; redCtxCmd: string; redPacketStr: string
  testCommand: string; testRunCmd: string; testFilesList: string; commitPrefix: string; commitCmd: string
  laneSpec: ContextFile
}): string {
  const { laneSpec, ...rest } = vars
  return withLaneSpec(redRetryTemplate, rest as PromptVars, laneSpec)
}

export function greenPrompt(vars: {
  greenCtxCmd: string; greenPacketStr: string
  testCommand: string; testRunCmd: string; implFilesList: string; commitPrefix: string; commitCmd: string; wt: string
  laneSpec: ContextFile
}): string {
  const { laneSpec, ...rest } = vars
  return withLaneSpec(greenTemplate, rest as PromptVars, laneSpec)
}

export function greenRetryPrompt(vars: {
  wt: string; failureReason: string; greenCtxCmd: string; greenRetryPacketStr: string
  testCommand: string; testRunCmd: string; implFilesList: string; commitPrefix: string; commitCmd: string
  laneSpec: ContextFile
}): string {
  const { laneSpec, ...rest } = vars
  return withLaneSpec(greenRetryTemplate, rest as PromptVars, laneSpec)
}

export function refactorPrompt(vars: {
  wt: string; refactorCtxCmd: string; refactorPacketStr: string
  testCommand: string; testRunCmd: string; allFilesList: string; commitPrefix: string; commitCmd: string
  tellsSlot: string
}): string {
  return PREAMBLE + renderPrompt(refactorTemplate, vars as PromptVars)
}

/**
 * The single writing stage of a structural lane (#341 task-001): produce the
 * declared files, commit. No suite, no tells slot — the runner decides the
 * lane from the deliverable check, never from this agent's report.
 */
export function structuralPrompt(vars: {
  wt: string; structuralCtxCmd: string; structuralPacketStr: string
  allFilesList: string; commitCmd: string
}): string {
  return PREAMBLE + renderPrompt(structuralTemplate, vars as PromptVars)
}

export function reflectPrompt(vars: { wt: string; testFiles: string; laneSpec: ContextFile }): string {
  const { laneSpec, ...rest } = vars
  return withLaneSpec(reflectTemplate, rest as PromptVars, laneSpec)
}

/**
 * #493 — FLOW.md's Act handoff says the skeptic panel reasons against
 * PROPERTIES.md; until now nothing relayed it. `properties` is null when
 * the epic has no PROPERTIES.md (no Properties phase ran) — the slot then
 * says so in one line instead of a Read instruction. When it exists, the
 * slot is `contextSlot()`: inline content within budget, else a mandatory
 * witnessed Read — the same shape as the lane spec, and the deferred file
 * (if any) joins the lane spec in the read-witness demand appended below.
 */
export function skepticBasePrompt(vars: {
  wt: string; implFiles: string; testFiles: string; testCommand: string
  laneSpec: ContextFile; properties: ContextFile | null
}): string {
  const { laneSpec, properties, ...rest } = vars
  const propertiesSlot = properties
    ? contextSlot(properties)
    : 'PROPERTIES.md does not exist for this epic (no Properties phase ran) — reason only against the acceptance criteria above.'
  const deferred = [laneSpec, ...(properties && !properties.inlined ? [properties] : [])]
  return (
    PREAMBLE +
    renderPrompt(skepticBaseTemplate, { ...rest, laneSpecSlot: contextSlot(laneSpec), propertiesSlot } as PromptVars) +
    contextWitnessInstruction(deferred)
  )
}

export function skepticLenses(): SkepticLens[] {
  return [
    { key: 'edge', model: model('fast'), prompt: skepticEdgeTemplate },
    { key: 'error', model: model('fast'), prompt: skepticErrorTemplate },
    { key: 'contract', model: model('balanced'), prompt: skepticContractTemplate },
  ]
}

export function refactorCheckPrompt(vars: { wt: string; allFiles: string; tellsSlot: string }): string {
  return PREAMBLE + renderPrompt(refactorCheckTemplate, vars as PromptVars)
}

export function docsCheckPrompt(vars: { changedFiles: string }): string {
  return PREAMBLE + renderPrompt(docsCheckTemplate, vars as PromptVars)
}

export function docsSyncPrompt(vars: { docsPacket: string }): string {
  return PREAMBLE + renderPrompt(docsSyncTemplate, vars as PromptVars)
}

// Epic-scoped lane-state markers — no TDD preamble; these are pure bookkeeping ops.
export function laneStateReadPrompt(vars: { epicBranch: string; epicSlug: string; taskIdsSpace: string }): string {
  return renderPrompt(laneStateReadTemplate, vars as PromptVars)
}

export function laneStateWritePrompt(vars: { epicBranch: string; epicSlug: string; runId: string; entriesJson: string }): string {
  return renderPrompt(laneStateWriteTemplate, vars as PromptVars)
}

// ── Script-only variants for batched datum-cli calls (#368) ─────────────────
// The lane-state templates wrap a bash script in a fenced block plus prose for
// a standalone agent. Batched calls embed just the script as one step.


/** The `datum lane-state read` loop; `epicBranch`/`taskIdsSpace` may be shell expressions. */
export function laneStateReadScript(vars: { epicBranch: string; epicSlug: string; taskIdsSpace: string }): string {
  return fencedScript(laneStateReadPrompt(vars))
}

/** The `datum lane-state write` loop for the given entries. */
export function laneStateWriteScript(vars: { epicBranch: string; epicSlug: string; runId: string; entriesJson: string }): string {
  return fencedScript(laneStateWritePrompt(vars))
}
