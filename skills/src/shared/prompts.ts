import { model } from './models'
import preambleTemplate from '../prompts/agent-preamble.md'
import redTemplate from '../prompts/red.md'
import redRetryTemplate from '../prompts/red-retry.md'
import greenTemplate from '../prompts/green.md'
import greenRetryTemplate from '../prompts/green-retry.md'
import refactorTemplate from '../prompts/refactor.md'
import commitTemplate from '../prompts/commit.md'
import reflectTemplate from '../prompts/reflect.md'
import skepticBaseTemplate from '../prompts/skeptic-base.md'
import skepticEdgeTemplate from '../prompts/skeptic-edge.md'
import skepticErrorTemplate from '../prompts/skeptic-error.md'
import skepticContractTemplate from '../prompts/skeptic-contract.md'
import refactorCheckTemplate from '../prompts/refactor-check.md'
import docsCheckTemplate from '../prompts/docs-check.md'
import docsSyncTemplate from '../prompts/docs-sync.md'
import { renderPrompt } from './utils'
import type { SkepticLens } from './types'

const PREAMBLE = preambleTemplate + '\n\n---\n\n'

type PromptVars = { [key: string]: string }

export function redPrompt(vars: {
  wt: string; skeletonCmd: string; redCtxCmd: string; redPacketStr: string
  testCommand: string; testFilesList: string; commitPrefix: string
  testFuncPattern?: string
}): string {
  return PREAMBLE + renderPrompt(redTemplate, vars as PromptVars)
}

export function redRetryPrompt(vars: {
  wt: string; failureReason: string; redCtxCmd: string; redPacketStr: string
  testCommand: string; testFilesList: string; commitPrefix: string
}): string {
  return PREAMBLE + renderPrompt(redRetryTemplate, vars as PromptVars)
}

export function greenPrompt(vars: {
  greenCtxCmd: string; greenPacketStr: string
  testCommand: string; implFilesList: string; commitPrefix: string; wt: string
}): string {
  return PREAMBLE + renderPrompt(greenTemplate, vars as PromptVars)
}

export function greenRetryPrompt(vars: {
  wt: string; failureReason: string; greenCtxCmd: string; greenRetryPacketStr: string
  testCommand: string; implFilesList: string; commitPrefix: string
}): string {
  return PREAMBLE + renderPrompt(greenRetryTemplate, vars as PromptVars)
}

export function refactorPrompt(vars: {
  wt: string; refactorCtxCmd: string; refactorPacketStr: string
  testCommand: string; allFilesList: string; commitPrefix: string
}): string {
  return PREAMBLE + renderPrompt(refactorTemplate, vars as PromptVars)
}

export function commitPrompt(vars: { wt: string; allowedList: string; commitPrefix: string; stage: string }): string {
  return PREAMBLE + renderPrompt(commitTemplate, vars as PromptVars)
}

export function reflectPrompt(vars: { wt: string; testFiles: string; acStr: string }): string {
  return PREAMBLE + renderPrompt(reflectTemplate, vars as PromptVars)
}

export function skepticBasePrompt(vars: { wt: string; implFiles: string; testFiles: string; testCommand: string; acStr: string }): string {
  return PREAMBLE + renderPrompt(skepticBaseTemplate, vars as PromptVars)
}

export function skepticLenses(): SkepticLens[] {
  return [
    { key: 'edge', model: model('fast'), prompt: skepticEdgeTemplate },
    { key: 'error', model: model('fast'), prompt: skepticErrorTemplate },
    { key: 'contract', model: model('balanced'), prompt: skepticContractTemplate },
  ]
}

export function refactorCheckPrompt(vars: { wt: string; allFiles: string }): string {
  return PREAMBLE + renderPrompt(refactorCheckTemplate, vars as PromptVars)
}

export function docsCheckPrompt(vars: { changedFiles: string }): string {
  return PREAMBLE + renderPrompt(docsCheckTemplate, vars as PromptVars)
}

export function docsSyncPrompt(vars: { docsPacket: string }): string {
  return PREAMBLE + renderPrompt(docsSyncTemplate, vars as PromptVars)
}
