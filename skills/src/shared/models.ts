export type ModelTier = 'fast' | 'balanced' | 'deep'
export type ModelName = 'haiku' | 'sonnet' | 'opus'

const TIER_MAP: Record<ModelTier, ModelName> = {
  fast: 'haiku',
  balanced: 'sonnet',
  deep: 'opus',
}

export function model(tier: ModelTier): ModelName {
  return TIER_MAP[tier]
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
export type FailureStage = TddStage | 'SKIPPED' | 'UNKNOWN' | 'CRASH'

export type LaneStatus = 'completed' | 'failed' | 'skipped'
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
} as const

export const READ_CONFIG_PROMPT = `Read .datum/config.json and return the raw JSON. If the file does not exist, return an error: {"error": "missing .datum/config.json — run datum init first"}. Output raw JSON only.`

export function skillPath(skillsDir: string, name: string): string {
  if (skillsDir) return `${skillsDir}/${name}.js`
  return `skills/${name}.js`
}
