import type { TddStage, FailureStage, LaneStatus, Severity, SkepticVerdict, TriageCategory, ModelName, RiskLevel } from './models'

// Cross-workflow arg/result contracts

export interface SetupArgs {
  batchRunId: string
  epicBranch: string
  batchLaneIds: string[]
  lanePlan: LanePlan
  batchTag: string
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
}
export interface MergeResult {
  merged: boolean
}

export interface DocsArgs {
  completedLanes: string[]
  lanePlan: LanePlan
  runId: string
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
}

export interface PipelineConfig {
  lanePlanPath: string
  epicBranch: string
  runId: string
  testCommand: string
  language: string
  test_framework?: string  // e.g. 'xctest', 'swift-testing', 'pytest', 'jest'
  skeletonDir?: string
}

export interface LaneOutcome {
  task_id: string
  status: LaneStatus
  stage?: FailureStage
  error?: string
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
