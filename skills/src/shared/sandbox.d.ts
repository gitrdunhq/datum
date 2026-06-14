declare module '*.md' {
  const content: string
  export default content
}

interface AgentOpts {
  label?: string
  phase?: string
  schema?: object
  model?: 'haiku' | 'sonnet' | 'opus'
  isolation?: 'worktree'
  agentType?: string
}

declare function agent(prompt: string, opts?: AgentOpts): Promise<any>
declare function parallel<T>(thunks: Array<() => Promise<T>>): Promise<(T | null)[]>
declare function pipeline<T>(items: T[], ...stages: Function[]): Promise<any[]>
declare function phase(title: string): void
declare function log(message: string): void
declare function workflow(ref: string | { scriptPath: string }, args?: any): Promise<any>
declare const args: any
declare const budget: {
  total: number | null
  spent(): number
  remaining(): number
}
