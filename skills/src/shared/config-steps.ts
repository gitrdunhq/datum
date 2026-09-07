// config-steps.ts — deterministic replacement for the LLM "read two config
// files and merge them by hand" relay described by READ_CONFIG_PROMPT
// (shared/models.ts, now retired). Extracted from datum-plan.ts's original
// configSteps/config-parse block (commit a7093d2 follow-up, #368 item 2) so
// datum-plan.ts, datum-validate.ts and datum-tdd-act.ts share ONE
// implementation instead of three copies.
//
// `repo-config` is the only non-tolerant step: a batch that never runs it
// (missing/failed) or a step whose stdout is not valid JSON means
// `datum init` was never run — a named failure, never "treat as {}".
// `global-config` is optional (may not exist) and degrades to {} on failure.
// tested-by: skills/src/shared/config-steps.test.ts

import type { BatchStep, BatchResult } from './batch'
import { stepStdout } from './batch'
import { mergeConfig } from './models'

export const MISSING_CONFIG_MESSAGE = 'missing .datum/config.json — run datum init first'

export function configReadSteps(): BatchStep[] {
  return [
    { name: 'repo-config', command: 'cat .datum/config.json' },
    { name: 'global-config', command: "cat ~/.datum/config.json 2>/dev/null || echo '{}'", tolerant: true },
  ]
}

/**
 * Parse + merge the two config-read steps' output (global defaults, repo
 * overrides, repo wins). Throws MISSING_CONFIG_MESSAGE — never returns a
 * half-valid/empty config — when the batch didn't run, the repo-config step
 * failed, or its stdout isn't valid JSON.
 */
export function configFromSteps(result: BatchResult): Record<string, unknown> {
  if (result.missing || result.failed) {
    throw new Error(MISSING_CONFIG_MESSAGE)
  }
  let repoCfgParsed: Record<string, unknown>
  try {
    repoCfgParsed = JSON.parse(stepStdout(result, 'repo-config') || '')
  } catch {
    throw new Error(MISSING_CONFIG_MESSAGE)
  }
  let globalCfgParsed: Record<string, unknown> = {}
  try {
    globalCfgParsed = JSON.parse(stepStdout(result, 'global-config') || '{}')
  } catch {
    globalCfgParsed = {}
  }
  return mergeConfig(globalCfgParsed, repoCfgParsed)
}
