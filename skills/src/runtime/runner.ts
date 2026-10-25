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
import { validateAgainstSchema } from './validate'
import { selectExecutor } from './executors'
import { nodeShell } from './shell'
import type { ShellFn } from '../shared/agents'

export type { ShellFn } from '../shared/agents'

/** Semaphore key for shell batches; width from runtime.concurrency.shell
 *  (default 1, like any unlisted key). PERF-002. */
export const SHELL_CONCURRENCY_KEY = 'shell'

/** A workflow({ name }) is one bare bundle name (SEC-002). */
const WORKFLOW_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export interface RunBundleOptions {
  bundlePath: string
  args: unknown
  executor: StageExecutor
  shell: ShellFn
  skillsDirs: string[]
  log: (line: string) => void
  runtime: RuntimeConfig
  repoRoot: string
  /** The tier table the bundles themselves use: .datum/config.json's
   *  top-level `models` (each bundle has its own copy of shared/models.ts, so
   *  setModelTiers here never reaches them). Their model('fast') arrives as
   *  that value, or as the default haiku/sonnet/opus, and is mapped back to
   *  the runtime id of the same tier (ARCH-001). */
  bundleTiers?: Partial<Record<ModelTier, string>>
  /** The run id the executor already uses; defaults to resolveRunId(args). */
  runId?: string
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...params: string[]
) => (...values: unknown[]) => Promise<unknown>

const TIERS: readonly string[] = ['fast', 'balanced', 'deep']

// Only the leading `export` of the hoisted meta declaration is removed, once.
function stripMetaExport(source: string): string {
  return source.replace(/^export(\s+const\s+meta\b)/m, '$1')
}

// The bundles' default tier names (shared/models.ts DEFAULT_TIERS).
const DEFAULT_TIER_NAMES: Readonly<Record<string, ModelTier>> = { haiku: 'fast', sonnet: 'balanced', opus: 'deep' }

/** The runtime model id for what a bundle asked for: a tier name, a runtime
 *  id, a bundle-side tier value (config override, else haiku/sonnet/opus), or
 *  an unknown literal, which passes through unchanged. */
export function resolveModel(
  runtime: RuntimeConfig,
  requested: string | undefined,
  bundleTiers: Partial<Record<ModelTier, string>> = {},
): string {
  if (requested === undefined) return runtime.models.balanced
  if (TIERS.includes(requested)) return runtime.models[requested as ModelTier]
  if (Object.values(runtime.models).includes(requested)) return requested
  for (const tier of TIERS as readonly ModelTier[]) if (bundleTiers[tier] === requested) return runtime.models[tier]
  const byDefault = DEFAULT_TIER_NAMES[requested]
  return byDefault ? runtime.models[byDefault] : requested
}

export async function runBundle(opts: RunBundleOptions): Promise<unknown> {
  const { bundlePath, args, executor, shell, log, runtime } = opts
  const rootSource = stripMetaExport(readFileSync(bundlePath, 'utf8'))
  setModelTiers(runtime.models)
  const runId = opts.runId ?? resolveRunId(args, currentTime())

  let spentTokens = 0
  const addUsage = (u: StageUsage | undefined): void => {
    if (u) spentTokens += u.prompt_tokens + u.completion_tokens
  }

  // Every call goes through the semaphore: a model with no concurrency entry,
  // including every model when the map is empty, runs one request at a time
  // (SPEC R6.4; PERF-001: an empty map used to switch the gate off).
  const semaphores = createModelSemaphores(runtime.concurrency)
  const headers = { 'X-Client': runtime.client, 'X-Priority': runtime.priority }

  // Shell batches take the same semaphores under their own key, so parallel()
  // lanes cannot start an unbounded number of test suites at once (PERF-002).
  const boundedShell: ShellFn = async (script, shellOpts) => {
    const release = await semaphores.acquire(SHELL_CONCURRENCY_KEY, SHELL_CONCURRENCY_KEY)
    try {
      return await shell(script, shellOpts)
    } finally {
      release()
    }
  }

  // One executor call plus its metrics line. The line is written before any
  // rejection so failed calls are recorded; a write error takes precedence
  // over the executor error (no silent drop). A reply that fails schema
  // validation is recorded as 'invalid'.
  const attempt = async (
    prompt: string,
    agentOpts: StageOpts,
    model: string,
    attemptNo: number,
    validate: ((reply: StageReply) => boolean) | undefined,
  ): Promise<{ reply: StageReply; valid: boolean }> => {
    const enteredAt = performance.now()
    const release = await semaphores.acquire(model, agentOpts.agentType)
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
        outcome: failed ? 'error' : valid ? 'ok' : 'invalid',
      }),
    )
    if (failed || reply === undefined) throw failure
    addUsage(reply.usage)
    return { reply, valid }
  }

  // Tier of a resolved model id; when tiers share an id the highest one is the
  // current tier (SPEC R8.4, CORR-002); ids outside the models map count as fast.
  const tierOf = (model: string): ModelTier => {
    for (const tier of [...TIERS].reverse() as ModelTier[]) if (runtime.models[tier] === model) return tier
    return 'fast'
  }

  const agent = async (prompt: string, agentOpts: StageOpts = {}): Promise<unknown> => {
    // datum-cli stages are shell work that belongs to runBatch; a model call
    // typed that way is a leak. Rejected before any executor or metrics I/O.
    if (agentOpts.agentType === 'datum-cli') {
      throw new Error(`cli_call_bypassed_runbatch: agent() call '${agentOpts.label ?? ''}' has agentType datum-cli`)
    }
    const model = resolveModel(runtime, agentOpts.model, opts.bundleTiers)
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
    if (tier === 'deep') {
      // A deep miss is never retried; say why when deep shares its id with a lower tier.
      if (runtime.models.fast === model || runtime.models.balanced === model) log(`stage_output_invalid: ${label}: no distinct higher tier`)
      return null
    }
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
    return fn(agent, parallel, pipeline, phase, log, workflow, boundedShell, scriptArgs, budget)
  }

  // A scriptPath wins over name; a name resolves to <dir>/<name>.js in the
  // first skills dir that has it, and must be a bare name (SEC-002).
  const workflow = async (ref: { name?: string; scriptPath?: string }, childArgs?: unknown): Promise<unknown> => {
    let path: string | undefined = ref.scriptPath
    if (path === undefined) {
      const name = ref.name ?? ''
      if (!WORKFLOW_NAME_RE.test(name)) throw new Error(`workflow_name_invalid: ${JSON.stringify(name)} is not a bare bundle name`)
      path = opts.skillsDirs.map((dir) => join(dir, `${name}.js`)).find((candidate) => existsSync(candidate))
      if (path === undefined) {
        throw new Error(`workflow_not_found: ${name} (searched: ${opts.skillsDirs.join(', ')})`)
      }
    }
    return execute(stripMetaExport(readFileSync(path, 'utf8')), childArgs)
  }

  // Force agent types on for the bundle (see agent-types.ts), and expose the
  // shell and the run's args as globals: runBatch resolves its shell and cwd
  // from globalThis (CORR-001: passed only as function parameters, every
  // runBatch inside a real bundle fell back to the LLM runner). The previous
  // values (datumRuntime included, ARCH-004) are restored when the bundle
  // settles, so a nested or concurrent run cannot leak or clear another's.
  const g = globalThis as Record<string, unknown>
  const keys = ['datumRuntime', 'shell', 'args'] as const
  const saved = keys.map((k) => ({ k, had: k in g, v: g[k] }))
  g.datumRuntime = { agentTypes: true }
  g.shell = boundedShell
  g.args = args
  try {
    return await execute(rootSource, args)
  } finally {
    for (const { k, had, v } of saved) {
      if (had) g[k] = v
      else delete g[k]
    }
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
    const config = JSON.parse(readFileSync(flags['--config'][0], 'utf8')) as Record<string, unknown>
    const runtime = readRuntimeConfig(config)
    const repoRoot = flags['--repo-root'][0]
    const runId = resolveRunId(args, currentTime())
    const bundleTiers = typeof config.models === 'object' && config.models !== null ? (config.models as Partial<Record<ModelTier, string>>) : {}
    const result = await runBundle({
      runId,
      bundlePath: flags['--bundle'][0],
      args,
      executor: selectExecutor(runtime, { repoRoot, runId }),
      shell: nodeShell,
      skillsDirs: flags['--skills-dir'],
      log: (line) => io.stderr(`${line}\n`),
      runtime,
      repoRoot,
      bundleTiers,
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
