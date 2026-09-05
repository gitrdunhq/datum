export type ModelTier = 'fast' | 'balanced' | 'deep'
export type ModelName = string

const DEFAULT_TIERS: Record<ModelTier, string> = {
  fast: 'haiku',
  balanced: 'sonnet',
  deep: 'opus',
}

let activeTiers: Record<ModelTier, string> = { ...DEFAULT_TIERS }

export function setModelTiers(tiers: Partial<Record<ModelTier, string>>): void {
  activeTiers = { ...DEFAULT_TIERS, ...tiers }
}

export function model(tier: ModelTier): string {
  return activeTiers[tier]
}

export const ROUTE_PHASES = {
  feature:       ['refine', 'plan', 'properties', 'act', 'validate', 'review', 'closeout'],
  hotfix:        ['act', 'validate', 'review'],
  spike:         ['refine', 'plan'],
  audit:         ['properties', 'validate', 'review'],
  resume:        [] as string[],
  'refine-only': ['refine'],
} as const

export type Route = keyof typeof ROUTE_PHASES
export type Phase = 'refine' | 'plan' | 'properties' | 'act' | 'validate' | 'review' | 'closeout'
export const PHASES: readonly Phase[] = ['refine', 'plan', 'properties', 'act', 'validate', 'review', 'closeout'] as const

export type TddStage = 'RED' | 'GREEN' | 'REFACTOR'
export type FailureStage = TddStage | 'MERGE' | 'SKIPPED' | 'UNKNOWN' | 'CRASH'

// 'blocked' = never dispatched because a dependency failed or was itself blocked;
// carries the root-cause lane in error. Distinct from 'skipped' (dep never ran).
export type LaneStatus = 'completed' | 'failed' | 'skipped' | 'blocked'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'] as const

export type SkepticVerdict = 'PASS' | 'FRAGILE' | 'BROKEN'
export type ReviewDomain = 'Security' | 'Performance' | 'Architecture' | 'Correctness'

export type AmbiguityLevel = 'high' | 'medium' | 'low' | 'trivial'
export type RiskLevel = 'low' | 'medium' | 'high'
export type TriageCategory = 'workflow-bug' | 'lane-plan' | 'agent-behavior' | 'infrastructure' | 'test-quality'
export type Scope = 'narrow' | 'moderate' | 'broad'
export type BranchType = 'main' | 'feature' | 'hotfix'
export type InputType = 'ticket' | 'bug' | 'question' | 'audit' | 'continuation' | 'raw-idea'

export const DEFAULT_CONFIG = {
  language: '',
  test_framework: '',
  test_command: '',
  skills_dir: '',
  context_files: [] as string[],
  /** #368: pass agentType on every mapped agent() call (off for runtimes without it). */
  agent_types: true,
  /** #368: written by `datum init` once the datum-* PreToolUse hooks are materialised. */
  hooks_installed: false,
}

/**
 * Deterministic replacement for the old LLM "read two configs and merge them
 * by hand" relay (READ_CONFIG_PROMPT, retired #368 item 2 — datum-plan.ts /
 * datum-validate.ts / datum-tdd-act.ts used to ask an agent to do this; a
 * hand-merged config with one wrong field — e.g. test_command — silently
 * poisons every downstream lane). Pure: callers get the two files' parsed
 * JSON via a deterministic batch step (shared/config-steps.ts: cat + parse),
 * not an LLM relay, then call this to merge.
 *
 * Semantics: start with global, overlay repo on top (repo wins on top-level
 * conflicts); for nested "models", merge keys (repo overrides individual
 * tiers) instead of replacing the whole object.
 */
export function mergeConfig(
  globalCfg: Record<string, unknown> | null | undefined,
  repoCfg: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const g = globalCfg && typeof globalCfg === 'object' ? globalCfg : {}
  const r = repoCfg && typeof repoCfg === 'object' ? repoCfg : {}
  const merged: Record<string, unknown> = { ...g, ...r }

  const gModels: Record<string, unknown> = g.models && typeof g.models === 'object' ? (g.models as Record<string, unknown>) : {}
  const rModels: Record<string, unknown> = r.models && typeof r.models === 'object' ? (r.models as Record<string, unknown>) : {}
  if (g.models || r.models) {
    merged.models = { ...gModels, ...rModels }
  }

  return merged
}

export function skillPath(skillsDir: string, name: string): string {
  if (skillsDir) return `${skillsDir}/${name}.js`
  return `skills/${name}.js`
}
