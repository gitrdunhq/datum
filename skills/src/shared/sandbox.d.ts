declare module '*.md' {
  const content: string
  export default content
}

interface AgentOpts {
  label?: string
  phase?: string
  schema?: object
  model?: string
  isolation?: 'worktree'
  // The checkout the agent runs in. Lane stages have always passed it; #349
  // (a skeptic lens that read the main checkout) and #375 (a review lens that
  // checked out another branch) are both what its absence costs.
  worktree?: string
  agentType?: string
}

// T defaults to `any` (not `unknown`) so every existing untyped call site keeps
// compiling as before; callers that know the agent's response shape (e.g. a
// prompt with a `schema`) should specialize as `agent<StageResult>(...)`.
declare function agent<T = any>(prompt: string, opts?: AgentOpts): Promise<T>
declare function parallel<T>(thunks: Array<() => Promise<T>>): Promise<(T | null)[]>
declare function pipeline<T>(items: T[], ...stages: Function[]): Promise<any[]>
declare function phase(title: string): void
declare function log(message: string): void
declare function workflow<T = any>(ref: string | { scriptPath: string } | { name: string }, args?: unknown): Promise<T>
declare const args: unknown
declare const budget: {
  total: number | null
  spent(): number
  remaining(): number
}
