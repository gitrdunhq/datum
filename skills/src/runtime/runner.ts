// runBundle: evaluates a post-processed workflow bundle inside an async
// function whose parameters are the sandbox globals (agent, parallel,
// pipeline, phase, log, workflow, shell, args, budget). All model traffic goes
// through the injected StageExecutor; the runner itself does no I/O besides
// reading the bundle file.

import { readFileSync } from 'node:fs'
import type { StageExecutor, StageOpts, StageReply, StageUsage } from './executor'
import type { ModelTier, RuntimeConfig } from '../shared/models'
import { setModelTiers } from '../shared/models'
import { parseAgentJson } from '../shared/utils'
import { createModelSemaphores } from './semaphore'
import { appendMetricsLine, buildMetricsLine, currentTime, resolveRunId } from './metrics'

export type ShellFn = (
  script: string,
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ exit_code: number; stdout: string; stderr: string }>

export interface RunBundleOptions {
  bundlePath: string
  args: unknown
  executor: StageExecutor
  shell: ShellFn
  skillsDirs: string[]
  log: (line: string) => void
  runtime: RuntimeConfig
  repoRoot: string
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...params: string[]
) => (...values: unknown[]) => Promise<unknown>

const TIERS: readonly string[] = ['fast', 'balanced', 'deep']

// Only the leading `export` of the hoisted meta declaration is removed, once.
function stripMetaExport(source: string): string {
  return source.replace(/^export(\s+const\s+meta\b)/m, '$1')
}

export function resolveModel(runtime: RuntimeConfig, requested: string | undefined): string {
  if (requested === undefined) return runtime.models.balanced
  return TIERS.includes(requested) ? runtime.models[requested as ModelTier] : requested
}

export async function runBundle(opts: RunBundleOptions): Promise<unknown> {
  const { bundlePath, args, executor, shell, log, runtime } = opts
  const source = stripMetaExport(readFileSync(bundlePath, 'utf8'))
  setModelTiers(runtime.models)
  const runId = resolveRunId(args, currentTime())

  let spentTokens = 0
  const addUsage = (u: StageUsage | undefined): void => {
    if (u) spentTokens += u.prompt_tokens + u.completion_tokens
  }

  // An empty concurrency map means no limits were configured, so calls are not
  // gated; once any entry exists, unlisted models run one request at a time.
  const gated = Object.keys(runtime.concurrency).length > 0
  const semaphores = createModelSemaphores(runtime.concurrency)
  const headers = { 'X-Client': runtime.client, 'X-Priority': runtime.priority }

  const agent = async (prompt: string, agentOpts: StageOpts = {}): Promise<unknown> => {
    const model = resolveModel(runtime, agentOpts.model)
    const enteredAt = performance.now()
    const release = gated ? await semaphores.acquire(model, agentOpts.agentType) : () => {}
    const acquiredAt = performance.now()
    let reply: StageReply | undefined
    let failure: unknown
    let failed = false
    try {
      reply = await executor.execute({ prompt, opts: agentOpts, model, headers: { ...headers } })
    } catch (err) {
      failed = true
      failure = err
    } finally {
      release()
    }
    // The line is written before any rejection so failed calls are recorded;
    // a write error takes precedence over the executor error (no silent drop).
    appendMetricsLine(
      opts.repoRoot,
      buildMetricsLine({
        ts: currentTime(),
        runId,
        label: agentOpts.label,
        agentType: agentOpts.agentType,
        model,
        reply,
        queueWaitMs: acquiredAt - enteredAt,
        wallMs: performance.now() - acquiredAt,
        attempt: 1,
        outcome: failed ? 'error' : 'ok',
      }),
    )
    if (failed || reply === undefined) throw failure
    addUsage(reply.usage)
    return parseAgentJson<unknown>(reply.text, null)
  }

  const parallel = async <T>(thunks: Array<() => Promise<T>>): Promise<(T | null)[]> =>
    Promise.all(
      thunks.map(async (thunk) => {
        try {
          return await thunk()
        } catch {
          return null
        }
      }),
    )

  const pipeline = async (items: unknown[], ...stages: Array<(v: unknown) => unknown>): Promise<unknown[]> =>
    Promise.all(
      items.map(async (item) => {
        try {
          let value: unknown = item
          for (const stage of stages) value = await stage(value)
          return value
        } catch {
          return null
        }
      }),
    )

  const phase = (title: string): void => log(`== ${title} ==`)
  const workflow = async (): Promise<never> => {
    throw new Error('workflow_not_implemented')
  }
  const budget = {
    total: null as number | null,
    spent: () => spentTokens,
    remaining: () => null as number | null,
  }

  const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'shell', 'args', 'budget', source)
  return fn(agent, parallel, pipeline, phase, log, workflow, shell, args, budget)
}
