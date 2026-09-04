import type { TddStage, FailureStage, LaneStatus, Severity, SkepticVerdict, TriageCategory, ModelName, RiskLevel, ModelTier, Phase, Route } from './models'
import type { AgentTypeConfig } from './agent-types'

// .datum/config.json, read via READ_CONFIG_PROMPT and merged onto DEFAULT_CONFIG.
// Named fields are the ones every script reads directly; anything else the repo
// puts in config.json still round-trips (index signature) without a compile error.
export interface RepoConfig {
  language?: string
  test_framework?: string
  test_command?: string
  skills_dir?: string
  context_files?: string[]
  agent_types?: boolean
  hooks_installed?: boolean
  models?: Partial<Record<ModelTier, string>>
  [key: string]: unknown
}

// Top-level `args` shapes each datum-*.ts entrypoint parses out of the sandbox's
// ambient `args` (string | object, hence still loosely typed at the source —
// see sandbox.d.ts). Casting the parsed value to one of these right after parsing
// is what makes `a.someField` a compile error when the field doesn't exist,
// instead of silently resolving to `undefined` at runtime (#368 postmortem).
export interface GoArgs {
  yolo?: boolean
  startFrom?: string
  route?: string
  phases?: Phase[]
  configFingerprint?: string
  freeText?: string
  issueNumber?: number
}

export interface PhaseArgs {
  yolo?: boolean
  agentTypes?: AgentTypeConfig
  freeText?: string
  issueNumber?: number | null
}

export interface CloseoutArgs extends PhaseArgs {
  runId?: string
}

export interface TddActArgs {
  yolo?: boolean
  testCommand?: string
  language?: string
  test_framework?: string
  lanePlanPath?: string
  epicBranch?: string
  runId?: string
  agentTypes?: AgentTypeConfig
}

// Cross-workflow arg/result contracts

export interface SetupArgs {
  batchRunId: string
  epicBranch: string
  batchLaneIds: string[]
  lanePlan: LanePlan
  lanePlanPath: string
  batchTag: string
  /** #368: agent_types / hooks_installed switches from the parent's config. */
  agentTypes?: AgentTypeConfig
}
export interface SetupResult {
  worktreePaths: Record<string, string>
}

export interface LaneArgs {
  batchLaneIds: string[]
  lanePlan: LanePlan
  worktreePaths: Record<string, string>
  cfg: PipelineConfig
  priorFailures: string[]
  priorCompleted: string[]
  batchTag: string
}
export interface LaneResult {
  results: Record<string, LaneOutcome>
}

export interface MergeArgs {
  completedIds: string[]
  results: Record<string, LaneOutcome>
  epicBranch: string
  batchRunId: string
  topoOrder: string[]
  batchTag: string
  agentTypes?: AgentTypeConfig
  /** #368: epic-scoped completion markers to record after a successful
   *  merge (folded into the merge batch; was a separate agent call). */
  laneState?: { epicSlug: string; entries: Array<{ task_id: string; spec_hash: string }> } | null
}
export interface MergeResult {
  merged: boolean
}

export interface DocsArgs {
  completedLanes: string[]
  lanePlan: LanePlan
  runId: string
  agentTypes?: AgentTypeConfig
}
export interface DocsResult {
  synced: boolean
  files?: string[]
}

export interface TriageArgs {
  failures: string[]
  blocked: LaneOutcome[]
  results: Record<string, LaneOutcome>
  lanePlan: LanePlan
  runId: string
  epicBranch: string
  agentTypes?: AgentTypeConfig
}
export interface TriageResult {
  filed: number
}

// Domain objects

export interface LanePlan {
  lanes: Record<string, Lane>
  topological_order: string[]
  total_lanes: number
}

export interface Lane {
  title: string
  files: string[]
  reads?: string[]
  depends_on?: string[]
  acceptance_criteria?: string[]
  red_note?: string
  stage?: 'structural' | 'behavioral'
  green_model?: ModelName
  /** Verbatim test command override for lanes the repo-wide command can't
   *  reach (e.g. files in a sub-package with its own Package.swift). When set,
   *  the auto Swift --filter scoping is skipped — the override carries its own
   *  scoping. Excluded from laneSpecHash: changing it never invalidates a
   *  completed lane marker. */
  test_command?: string
  /** GitHub sub-issue number, written back by `datum plan-issues` (datum/github_issues.py). */
  github_issue?: number
}

export interface PipelineConfig {
  lanePlanPath: string
  epicBranch: string
  runId: string
  testCommand: string
  language: string
  test_framework?: string  // e.g. 'xctest', 'swift-testing', 'pytest', 'jest'
  skeletonDir?: string
  /** yolo mode (#356): a blocked GREEN auto-widens allowed_write_files for
   *  src/ paths and re-runs once instead of stopping for lead approval. */
  yolo?: boolean
  /** #368: agent_types / hooks_installed switches, passed from the parent
   *  so the lane bundle (its own copy of the agent-types state) can
   *  configure itself. */
  agentTypes?: AgentTypeConfig
}

export interface LaneOutcome {
  task_id: string
  status: LaneStatus
  stage?: FailureStage
  error?: string
  /** #356: files GREEN needs write access to before it can pass. Set only on
   *  a `blocked` GREEN outcome; the orchestrator surfaces it once as a single
   *  lead-approval question. */
  needs_write?: string[]
}

// Agent result types

export interface WriteResult {
  files_written?: string[]
  success: boolean
  failure_reason?: string
}

export interface StageResult {
  files_written?: string[]
  success: boolean
  tests_pass: boolean
  test_exit_code?: number
  test_errors?: string[]
  test_output?: string
  committed: boolean
  commit_sha?: string
  failure_reason?: string
  /** #356: structured GREEN block. `blocked` means "tests cannot pass without
   *  writing `needs_write`", which the agent must NOT write. */
  status?: 'ok' | 'blocked'
  needs_write?: string[]
  reason?: string
}

/** JSON emitted by `python -m datum.contract_preflight` (#356). */
export interface ContractPreflight {
  status: 'ok' | 'contract_conflict' | 'skipped'
  conflicts: Array<{
    test: string
    kind: string
    error_type: string
    message: string
    origin_file: string | null
    symbol: string | null
    defined_in: string[]
  }>
  needs_write: string[]
  reason: string
  pytest_exit_code?: number | null
}

export interface CommitResult {
  committed: boolean
  commit_sha?: string
  files_staged?: string[]
  violations?: string[]
  failure_reason?: string
}

export interface ReflectResult {
  reasoning: string
  gaps?: string[]
  score: number
}

export interface SkepticBug {
  description: string
  evidence: string
  severity: Severity
}

export interface SkepticResult {
  bugs_found: SkepticBug[]
  confidence: number
  verdict: SkepticVerdict
}

export interface RefactorCheck {
  should_refactor: boolean
  reason?: string
}

export interface VerifyResult {
  verified: boolean
  error?: string
  test_signal?: TestSignal
}

export interface TestSignal {
  exit_code: number
  errors: string[]
  assertion_messages: string[]
}

export interface TriageIssue {
  title: string
  category: TriageCategory
  severity: Severity
  body: string
  lane?: string
  stage?: string
}

export interface TriageAnalysis {
  issues: TriageIssue[]
}

// Packet types

export interface TaskPacket {
  schema_version: string
  task_id: string
  stage: TddStage
  title: string
  working_directory: string
  test_command: string
  acceptance_criteria: string[]
  red_note: string
  allowed_write_files: string[]
  forbidden_write_files: string[]
  commit_prefix: string
  target_context?: Record<string, string[]>
  [key: string]: unknown
}

export interface SkepticLens {
  key: string
  model: ModelName
  prompt: string
}
