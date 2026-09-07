import { model } from './models'
import preambleTemplate from '../prompts/agent-preamble.md'
import redTemplate from '../prompts/red.md'
import redRetryTemplate from '../prompts/red-retry.md'
import greenTemplate from '../prompts/green.md'
import greenRetryTemplate from '../prompts/green-retry.md'
import refactorTemplate from '../prompts/refactor.md'
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

export function reflectPrompt(vars: { wt: string; testFiles: string; laneSpec: ContextFile }): string {
  const { laneSpec, ...rest } = vars
  return withLaneSpec(reflectTemplate, rest as PromptVars, laneSpec)
}

export function skepticBasePrompt(vars: { wt: string; implFiles: string; testFiles: string; testCommand: string; laneSpec: ContextFile }): string {
  const { laneSpec, ...rest } = vars
  return withLaneSpec(skepticBaseTemplate, rest as PromptVars, laneSpec)
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
