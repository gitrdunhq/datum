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
  batchTag: string
}
export interface LaneResult {
  results: Record<string, LaneOutcome>
}

export interface MergeArgs {
  completedIds: string[]
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
  depends_on?: string[]
  acceptance_criteria?: string[]
  red_note?: string
  stage?: 'structural' | 'behavioral'
  green_model?: string
}

export interface PipelineConfig {
  lanePlanPath: string
  epicBranch: string
  runId: string
  testCommand: string
  language: string
}

export interface LaneOutcome {
  task_id: string
  status: 'completed' | 'failed'
  stage?: string
  error?: string
}

// Agent result types

export interface WriteResult {
  files_written?: string[]
  success: boolean
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
  severity: 'critical' | 'high' | 'medium' | 'low'
}

export interface SkepticResult {
  bugs_found: SkepticBug[]
  confidence: number
  verdict: 'PASS' | 'FRAGILE' | 'BROKEN'
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
  category: 'workflow-bug' | 'lane-plan' | 'agent-behavior' | 'infrastructure' | 'test-quality'
  severity: 'critical' | 'high' | 'medium' | 'low'
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
  stage: 'RED' | 'GREEN' | 'REFACTOR'
  title: string
  working_directory: string
  test_command: string
  acceptance_criteria: string[]
  red_note: string
  allowed_write_files: string[]
  forbidden_write_files: string[]
  commit_prefix: string
  [key: string]: unknown
}

export interface SkepticLens {
  key: string
  model: 'haiku' | 'sonnet'
  prompt: string
}
