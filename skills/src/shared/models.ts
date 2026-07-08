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

export function getModelTiers(): Record<ModelTier, string> {
  return { ...activeTiers }
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
}

export const READ_CONFIG_PROMPT = `Read TWO config files and merge them (global defaults, repo overrides):
1. Global: ~/.datum/config.json (may not exist — skip if missing)
2. Repo: .datum/config.json (required — if missing, return {"error": "missing .datum/config.json — run datum init first"})
Merge: start with global, overlay repo on top (repo wins on conflict). For nested objects like "models", merge keys (repo overrides individual tiers).
Return the merged JSON. Output raw JSON only.`

export function skillPath(skillsDir: string, name: string): string {
  if (skillsDir) return `${skillsDir}/${name}.js`
  return `skills/${name}.js`
}
