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

type PromptVars = { [key: string]: string }

export function redPrompt(vars: {
  wt: string; skeletonCmd: string; redCtxCmd: string; redPacketStr: string
  testCommand: string; testFilesList: string; commitPrefix: string
}): string {
  return renderPrompt(redTemplate, vars as PromptVars)
}

export function redRetryPrompt(vars: {
  wt: string; failureReason: string; redCtxCmd: string; redPacketStr: string
  testCommand: string; testFilesList: string; commitPrefix: string
}): string {
  return renderPrompt(redRetryTemplate, vars as PromptVars)
}

export function greenPrompt(vars: {
  greenCtxCmd: string; greenPacketStr: string
  testCommand: string; implFilesList: string; commitPrefix: string; wt: string
}): string {
  return renderPrompt(greenTemplate, vars as PromptVars)
}

export function greenRetryPrompt(vars: {
  wt: string; failureReason: string; greenCtxCmd: string; greenRetryPacketStr: string
  testCommand: string; implFilesList: string; commitPrefix: string
}): string {
  return renderPrompt(greenRetryTemplate, vars as PromptVars)
}

export function refactorPrompt(vars: {
  wt: string; refactorCtxCmd: string; refactorPacketStr: string
  testCommand: string; allFilesList: string; commitPrefix: string
}): string {
  return renderPrompt(refactorTemplate, vars as PromptVars)
}

export function commitPrompt(vars: { wt: string; allowedList: string; commitPrefix: string; stage: string }): string {
  return renderPrompt(commitTemplate, vars as PromptVars)
}

export function reflectPrompt(vars: { wt: string; testFiles: string; acStr: string }): string {
  return renderPrompt(reflectTemplate, vars as PromptVars)
}

export function skepticBasePrompt(vars: { wt: string; implFiles: string; testFiles: string; testCommand: string; acStr: string }): string {
  return renderPrompt(skepticBaseTemplate, vars as PromptVars)
}

export function skepticLenses(): SkepticLens[] {
  return [
    { key: 'edge', model: 'haiku', prompt: skepticEdgeTemplate },
    { key: 'error', model: 'haiku', prompt: skepticErrorTemplate },
    { key: 'contract', model: 'sonnet', prompt: skepticContractTemplate },
  ]
}

export function refactorCheckPrompt(vars: { wt: string; allFiles: string }): string {
  return renderPrompt(refactorCheckTemplate, vars as PromptVars)
}

export function docsCheckPrompt(vars: { changedFiles: string }): string {
  return renderPrompt(docsCheckTemplate, vars as PromptVars)
}

export function docsSyncPrompt(vars: { docsPacket: string }): string {
  return renderPrompt(docsSyncTemplate, vars as PromptVars)
}
