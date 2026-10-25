// PiExecutor: one agent() call becomes one `bash <stage_script> <worktree>
// <stage.json>` run (LLM-363). The prompt goes to prompt.md, the script writes
// reply.json next to it, and exit codes map to named errors. No retries here:
// the runner owns the one-tier-up retry and the per-model semaphores.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { StageExecutor, StageReply, StageRequest, StageTimings, StageUsage } from './executor'
import type { RuntimeConfig } from '../shared/models'
import { isReadOnlyAgentType } from '../shared/agent-types'

/** Where the container sees the worktree until LLM-335/336 lands. */
export const CONTAINER_WORKTREE = '/work'
/** Extra seconds past stage_timeout_s before the process group is killed. */
export const HARD_KILL_GRACE_S = 60
export const STDERR_TAIL_CHARS = 2048

// ── Pure helpers ─────────────────────────────────────────────────────────

export function sanitizeLabel(label: string): string {
  const cleaned = label.replace(/[^A-Za-z0-9._-]/g, '_')
  return cleaned === '' ? 'unlabeled' : cleaned
}

/** `datum-red` -> `red`; undefined when there is no datum- agent type. */
export function roleOf(agentType: string | undefined): string | undefined {
  if (agentType === undefined || !agentType.startsWith('datum-') || agentType.length === 'datum-'.length) return undefined
  return agentType.slice('datum-'.length)
}

/** Every occurrence of the host worktree path becomes /work; nothing else changes. */
export function rewritePrompt(prompt: string, worktree: string): string {
  return prompt.split(worktree).join(CONTAINER_WORKTREE)
}

export function exitErrorCode(code: number): string | undefined {
  if (code === 2) return 'stage_usage_error'
  if (code === 3) return 'stage_guard_blocked'
  if (code === 4) return 'stage_timeout'
  return undefined
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validates the parsed reply.json; returns the reply or the reason it is invalid. */
export function parseReply(raw: unknown): { reply: StageReply } | { why: string } {
  if (!isRecord(raw)) return { why: 'reply.json is not an object' }
  if (typeof raw.text !== 'string') return { why: 'text is not a string' }
  const reply: StageReply = { text: raw.text }
  if (raw.usage !== undefined) {
    const u = raw.usage
    if (!isRecord(u) || !isNum(u.prompt_tokens) || !isNum(u.completion_tokens) || !isNum(u.cached_tokens)) {
      return { why: 'usage needs numeric prompt_tokens, completion_tokens, cached_tokens' }
    }
    const usage: StageUsage = { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens, cached_tokens: u.cached_tokens }
    reply.usage = usage
  }
  if (raw.timings !== undefined) {
    const t = raw.timings
    if (!isRecord(t) || !isNum(t.prefill_ms) || !isNum(t.decode_ms)) return { why: 'timings needs numeric prefill_ms, decode_ms' }
    const timings: StageTimings = { prefill_ms: t.prefill_ms, decode_ms: t.decode_ms }
    reply.timings = timings
  }
  return { reply }
}

// ── Executor ─────────────────────────────────────────────────────────────

interface RunResult {
  code: number | null
  signal: string | null
  stderrTail: string
  hardKilled: boolean
  spawnError?: Error
}

function runScript(script: string, worktree: string, stageJson: string, hardKillMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn('bash', [script, worktree, stageJson], { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    let tail = ''
    let hardKilled = false
    let done = false
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      tail = (tail + chunk).slice(-STDERR_TAIL_CHARS)
    })
    const timer = setTimeout(() => {
      hardKilled = true
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, hardKillMs)
    const finish = (r: Omit<RunResult, 'stderrTail' | 'hardKilled'>): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ...r, stderrTail: tail, hardKilled })
    }
    child.on('error', (err) => finish({ code: null, signal: null, spawnError: err }))
    child.on('close', (code, signal) => finish({ code, signal }))
  })
}

interface LaneGuard {
  allowed_write_files: string[]
  forbidden_write_files: string[]
  read_only: boolean
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** The guard for one stage: empty and read-only for judges, else the lists from lane-context.json. */
function buildLaneGuard(agentType: string | undefined, worktree: string, fail: (code: string, detail?: string) => Error): LaneGuard {
  if (isReadOnlyAgentType(agentType)) return { allowed_write_files: [], forbidden_write_files: [], read_only: true }
  const ctxFile = join(worktree, '.datum', 'lane-context.json')
  if (!existsSync(ctxFile)) throw fail('stage_guard_context_missing')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(ctxFile, 'utf8'))
  } catch (err) {
    throw fail('stage_guard_context_invalid', `cannot read lane-context.json: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!isRecord(raw) || !isStringArray(raw.allowed_write_files) || !isStringArray(raw.forbidden_write_files)) {
    throw fail('stage_guard_context_invalid', 'lane-context.json needs string arrays allowed_write_files and forbidden_write_files')
  }
  return { allowed_write_files: raw.allowed_write_files, forbidden_write_files: raw.forbidden_write_files, read_only: false }
}

export class PiExecutor implements StageExecutor {
  private counter = 0

  constructor(
    private readonly runtime: RuntimeConfig,
    private readonly ctx: { repoRoot: string; runId: string },
  ) {}

  async execute(req: StageRequest): Promise<StageReply> {
    const label = req.opts.label ?? ''
    const role = roleOf(req.opts.agentType)
    if (role === undefined) throw new Error(`stage_role_missing: ${label}: agentType ${JSON.stringify(req.opts.agentType)} is not a datum- agent type`)
    const worktree = req.opts.worktree ?? this.ctx.repoRoot
    if (!isAbsolute(worktree) || !isDirectory(worktree)) {
      throw new Error(`stage_worktree_missing: ${label}: ${worktree} is not an existing absolute directory`)
    }
    const { stageScript: script, stageTimeoutS: timeoutS } = this.runtime
    if (script === undefined || timeoutS === undefined) throw new Error(`runtime_stage_script_missing: ${label}`)

    this.counter += 1
    const dir = join(this.ctx.repoRoot, '.datum', 'runs', this.ctx.runId, 'stages', `${this.counter}-${sanitizeLabel(label)}`)
    const fail = (code: string, detail?: string): Error => new Error(`${code}: ${label} (${dir})${detail === undefined ? '' : `: ${detail}`}`)

    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const promptFile = join(dir, 'prompt.md')
    const replyFile = join(dir, 'reply.json')
    const stageJson = join(dir, 'stage.json')
    writeFileSync(promptFile, rewritePrompt(req.prompt, worktree))
    writeFileSync(
      stageJson,
      JSON.stringify({
        model: req.model,
        role,
        read_only: isReadOnlyAgentType(req.opts.agentType),
        prompt_file: promptFile,
        reply_file: replyFile,
        timeout_s: timeoutS,
        headers: req.headers,
        label,
        worktree,
      }),
    )

    const guard = buildLaneGuard(req.opts.agentType, worktree, fail)
    mkdirSync(join(worktree, '.datum'), { recursive: true })
    writeFileSync(join(worktree, '.datum', 'lane-guard.json'), JSON.stringify(guard))

    const result = await runScript(script, worktree, stageJson, (timeoutS + HARD_KILL_GRACE_S) * 1000)
    if (result.spawnError !== undefined) throw fail('stage_failed', `spawn error: ${result.spawnError.message}`)
    if (result.hardKilled) throw fail('stage_timeout', `process group killed after ${timeoutS + HARD_KILL_GRACE_S}s`)
    if (result.code === null) throw fail('stage_failed', `killed by signal ${result.signal ?? 'unknown'}\n${result.stderrTail}`)
    if (result.code !== 0) {
      const named = exitErrorCode(result.code)
      if (named !== undefined) throw fail(named)
      throw fail(`stage_failed: exit ${result.code}`, result.stderrTail)
    }

    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(replyFile, 'utf8'))
    } catch (err) {
      throw fail('stage_reply_invalid', `cannot read reply.json: ${err instanceof Error ? err.message : String(err)}`)
    }
    const parsed = parseReply(raw)
    if ('why' in parsed) throw fail('stage_reply_invalid', parsed.why)
    return parsed.reply
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
