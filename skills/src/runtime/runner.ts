// runBundle: evaluates a post-processed workflow bundle inside an async
// function whose parameters are the sandbox globals (agent, parallel,
// pipeline, phase, log, workflow, shell, args, budget). All model traffic goes
// through the injected StageExecutor; the runner itself does no I/O besides
// reading the bundle file.

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { StageExecutor, StageOpts, StageReply, StageUsage } from './executor'
import type { ModelTier, RuntimeConfig } from '../shared/models'
import { readRuntimeConfig, setModelTiers } from '../shared/models'
import { parseAgentJson } from '../shared/utils'
import { createModelSemaphores } from './semaphore'
import { appendMetricsLine, buildMetricsLine, currentTime, resolveRunId } from './metrics'
import type { MetricsOutcome } from './metrics'
import { validateAgainstSchema } from './validate'
import { FakeExecutor } from './fake-executor'
import { nodeShell } from './shell'

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
  const rootSource = stripMetaExport(readFileSync(bundlePath, 'utf8'))
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

  // One executor call plus its metrics line. The line is written before any
  // rejection so failed calls are recorded; a write error takes precedence
  // over the executor error (no silent drop). A reply that fails schema
  // validation is recorded as 'invalid' (outcome is widened locally because
  // the MetricsOutcome type lives outside this lane's files).
  const attempt = async (
    prompt: string,
    agentOpts: StageOpts,
    model: string,
    attemptNo: number,
    validate: ((reply: StageReply) => boolean) | undefined,
  ): Promise<{ reply: StageReply; valid: boolean }> => {
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
    const valid = !failed && reply !== undefined && (validate ? validate(reply) : true)
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
        attempt: attemptNo,
        outcome: (failed ? 'error' : valid ? 'ok' : 'invalid') as MetricsOutcome,
      }),
    )
    if (failed || reply === undefined) throw failure
    addUsage(reply.usage)
    return { reply, valid }
  }

  // Tier of a resolved model id; ids outside the models map count as fast.
  const tierOf = (model: string): ModelTier => {
    for (const tier of TIERS as readonly ModelTier[]) if (runtime.models[tier] === model) return tier
    return 'fast'
  }

  const agent = async (prompt: string, agentOpts: StageOpts = {}): Promise<unknown> => {
    // datum-cli stages are shell work that belongs to runBatch; a model call
    // typed that way is a leak. Rejected before any executor or metrics I/O.
    if (agentOpts.agentType === 'datum-cli') {
      throw new Error(`cli_call_bypassed_runbatch: agent() call '${agentOpts.label ?? ''}' has agentType datum-cli`)
    }
    const model = resolveModel(runtime, agentOpts.model)
    const schema = agentOpts.schema
    if (schema === undefined) {
      const { reply } = await attempt(prompt, agentOpts, model, 1, undefined)
      return parseAgentJson<unknown>(reply.text, null)
    }
    const label = agentOpts.label ?? ''
    let lastProblems: string[] = []
    const check = (reply: StageReply): boolean => {
      lastProblems = validateAgainstSchema(schema, parseAgentJson<unknown>(reply.text, null))
      return lastProblems.length === 0
    }
    const first = await attempt(prompt, agentOpts, model, 1, check)
    if (first.valid) return parseAgentJson<unknown>(first.reply.text, null)
    log(`stage_output_invalid: ${label}: ${lastProblems.join(', ')}`)
    const tier = tierOf(model)
    if (tier === 'deep') return null
    const retryModel = runtime.models[tier === 'fast' ? 'balanced' : 'deep']
    if (retryModel === model) {
      log(`stage_output_invalid: ${label}: no distinct higher tier`)
      return null
    }
    const second = await attempt(prompt, { ...agentOpts, model: retryModel }, retryModel, 2, check)
    if (second.valid) return parseAgentJson<unknown>(second.reply.text, null)
    log(`stage_output_invalid: ${label}: ${lastProblems.join(', ')}`)
    return null
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
  const budget = {
    total: null as number | null,
    spent: () => spentTokens,
    remaining: () => null as number | null,
  }

  // Child workflows run through the same agent/semaphores/metrics/shell
  // closures as the parent; only `args` differs.
  const execute = (source: string, scriptArgs: unknown): Promise<unknown> => {
    const fn = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'shell', 'args', 'budget', source)
    return fn(agent, parallel, pipeline, phase, log, workflow, shell, scriptArgs, budget)
  }

  // A scriptPath wins over name; a name resolves to <dir>/<name>.js in the
  // first skills dir that has it.
  const workflow = async (ref: { name?: string; scriptPath?: string }, childArgs?: unknown): Promise<unknown> => {
    let path: string | undefined = ref.scriptPath
    if (path === undefined) {
      const name = ref.name ?? ''
      path = opts.skillsDirs.map((dir) => join(dir, `${name}.js`)).find((candidate) => existsSync(candidate))
      if (path === undefined) {
        throw new Error(`workflow_not_found: ${name} (searched: ${opts.skillsDirs.join(', ')})`)
      }
    }
    return execute(stripMetaExport(readFileSync(path, 'utf8')), childArgs)
  }

  // Force agent types on for the bundle (see agent-types.ts); always removed
  // when the bundle settles.
  ;(globalThis as Record<string, unknown>).datumRuntime = { agentTypes: true }
  try {
    return await execute(rootSource, args)
  } finally {
    delete (globalThis as Record<string, unknown>).datumRuntime
  }
}

export interface MainIo {
  stdout: (text: string) => void
  stderr: (text: string) => void
}

const MAIN_FLAGS = ['--bundle', '--args', '--config', '--repo-root', '--skills-dir'] as const

// Flags are `--name value` pairs; --skills-dir may repeat. Unknown flags and
// missing values or flags fail fast with a named error.
function parseMainArgv(argv: readonly string[]): Record<(typeof MAIN_FLAGS)[number], string[]> {
  const found: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    if (!(MAIN_FLAGS as readonly string[]).includes(flag)) throw new Error(`runner_flag_unknown: ${flag}`)
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`runner_flag_value_missing: ${flag}`)
    ;(found[flag] ??= []).push(value)
  }
  for (const flag of MAIN_FLAGS) {
    if (found[flag] === undefined) throw new Error(`runner_flag_missing: ${flag}`)
  }
  return found as Record<(typeof MAIN_FLAGS)[number], string[]>
}

/**
 * Node entry: runs one bundle and reports through the injected writers.
 * Returns the process exit code (0 ok, 1 failure). stdout carries only the
 * bundle result as JSON; log lines and errors go to stderr.
 */
export async function main(argv: readonly string[], io: MainIo): Promise<number> {
  try {
    const flags = parseMainArgv(argv)
    const args: unknown = JSON.parse(readFileSync(flags['--args'][0], 'utf8'))
    const runtime = readRuntimeConfig(JSON.parse(readFileSync(flags['--config'][0], 'utf8')) as Record<string, unknown>)
    if (runtime.kind !== 'fake') throw new Error(`runtime_kind_unsupported: ${runtime.kind}`)
    const result = await runBundle({
      bundlePath: flags['--bundle'][0],
      args,
      executor: new FakeExecutor([], { text: '{}' }),
      shell: nodeShell,
      skillsDirs: flags['--skills-dir'],
      log: (line) => io.stderr(`${line}\n`),
      runtime,
      repoRoot: flags['--repo-root'][0],
    })
    io.stdout(`${JSON.stringify(result ?? null)}\n`)
    return 0
  } catch (err) {
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

// Runs only when this file is the process entry (the bundled runner.js), never
// when imported by tests or other modules. The process handle is destructured
// once: the runner is the one Node-only module under skills/src, and the
// sandbox-globals tripwire matches on the `process.<member>` spelling.
const { argv: processArgv, stdout: processStdout, stderr: processStderr } = process
if (processArgv[1] !== undefined && import.meta.url === pathToFileURL(resolve(processArgv[1])).href) {
  void main(processArgv.slice(2), {
    stdout: (text) => void processStdout.write(text),
    stderr: (text) => void processStderr.write(text),
  }).then((code) => {
    process.exitCode = code
  })
}
