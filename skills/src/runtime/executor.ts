// Contract between the bundle runner and whatever answers a stage prompt.
// The runner owns sandbox semantics (parallel, pipeline, budget); an executor
// only turns one StageRequest into one StageReply.

export interface StageOpts {
  label?: string
  phase?: string
  schema?: object
  model?: string
  isolation?: 'worktree'
  worktree?: string
  agentType?: string
}

export interface StageRequest {
  prompt: string
  opts: StageOpts
  /** Resolved model id (never a tier name). */
  model: string
  headers: Record<string, string>
}

export interface StageUsage {
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
}

export interface StageTimings {
  prefill_ms: number
  decode_ms: number
}

export interface StageReply {
  text: string
  usage?: StageUsage
  timings?: StageTimings
}

export interface StageExecutor {
  execute(req: StageRequest): Promise<StageReply>
}
