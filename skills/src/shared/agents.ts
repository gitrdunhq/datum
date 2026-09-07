import { model } from './models'
import { utf8ByteLength } from './utf8'
import { stageOpts } from './agent-types'
import { batchCommandPrompt, parseBatchResult, stepStdout, describeFailure, isRunnerRefusal, type BatchStep, type BatchResult } from './batch'
import { worktreeDirtySteps, worktreeDirtyFromSteps } from './commit-steps'

// ── Rate-limit resilient agent wrapper ──────────────────────────────────────

const RATE_LIMIT_MAX_RETRIES = 4
const RATE_LIMIT_BASE_DELAY_MS = 5_000
const RATE_LIMIT_JITTER_MS = 2_000

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ── Independent commit verification (#274) ──────────────────────────────────
// A stage agent self-reports `committed` in its structured output. If it
// reports false, that's ambiguous: either it genuinely skipped the commit, or
// it committed correctly but mis-filled the schema field. Rather than trust
// the self-report blindly, check the worktree directly before failing the
// lane — a false negative here wastes a full retry/escalation cycle on work
// that already succeeded.
export interface CommitVerification {
  committed: boolean
  commitSha?: string
  clean?: boolean
  detail: string
}

/**
 * Pure decision over the two step outputs: the lane's log (`<base>..HEAD`,
 * `%H %s`) and `git status --porcelain` for the stage's files. A lane may
 * already have progressed past this stage (RED -> GREEN -> REFACTOR) when the
 * check runs, so the target commit is searched anywhere in the lane's log.
 */
export function parseCommitVerification(
  logStdout: string | null | undefined,
  statusStdout: string | null | undefined,
  commitPrefix: string,
  stage: string,
): CommitVerification {
  if (logStdout === null || logStdout === undefined) {
    return { committed: false, detail: 'independent check returned no result (log step did not run)' }
  }
  const shaLine = /^[0-9a-f]{40} /
  const logLines = String(logStdout).split('\n').map((l) => l.trim()).filter((l) => shaLine.test(l))
  const statusLines = String(statusStdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  const target = `${commitPrefix}: ${stage} complete`
  const match = logLines.find((l) => l.includes(target))
  const clean = statusLines.length === 0
  return {
    committed: Boolean(match) && clean,
    commitSha: match ? match.split(' ')[0] : '',
    clean,
    detail: match
      ? `found_commit="${match}" uncommitted_files=${statusLines.length}`
      : `no commit matching "${target}" found in history; uncommitted_files=${statusLines.length}`,
  }
}

/**
 * Did the stage agent really commit? Runs as a datum-cli batch (never an LLM
 * echo of raw git output) with the log BOUNDED to the lane's own commits —
 * an unbounded `git log` was 90 KB in a real consumer repo and the relay
 * truncated it (726dbd8). `baseRef` is the epic branch; when absent the log
 * is capped at 200 entries.
 */
export async function verifyCommitIndependently(
  taskId: string,
  wt: string,
  files: string[],
  commitPrefix: string,
  stage: string,
  baseRef?: string,
): Promise<CommitVerification> {
  const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`
  const range = baseRef ? `${q(baseRef)}..HEAD` : '-n 200'
  const steps: BatchStep[] = [
    { name: 'log', command: `git -C ${q(wt)} log --format="%H %s" ${range}`, tolerant: true },
    { name: 'status', command: `git -C ${q(wt)} status --porcelain -- ${files.map(q).join(' ')}`, tolerant: true },
  ]
  const raw = await agent(
    batchCommandPrompt(steps),
    stageOpts('cli', { label: `verify-commit:${taskId}:${stage}`, model: model('fast') }),
  )
  const result = parseBatchResult(raw, steps)
  if (result.missing) return { committed: false, detail: `independent check returned no result (${describeFailure(result, 'verify-commit')})` }
  return parseCommitVerification(stepStdout(result, 'log'), stepStdout(result, 'status'), commitPrefix, stage)
}

// Injectable deps so resilientAgent's retry/backoff/dirty-guard logic can be
// exercised in unit tests without the sandbox's ambient `agent`/`log`
// globals. Production callers never pass this — it defaults to the real
// globals, so behavior is unchanged for every existing call site.
export interface ResilientAgentDeps<T = unknown> {
  agentFn?: (prompt: string, opts?: AgentOpts) => Promise<T>
  logFn?: (message: string) => void
}

export async function resilientAgent<T = unknown>(
  prompt: string,
  opts?: AgentOpts & { maxRetries?: number; worktree?: string },
  deps?: ResilientAgentDeps<T>,
): Promise<T | null> {
  const agentFn = deps?.agentFn ?? agent
  const logFn = deps?.logFn ?? log
  const maxRetries = opts?.maxRetries ?? RATE_LIMIT_MAX_RETRIES
  let lastResult: T | null = null

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // A subagent that stalls mid-conversation and never calls
    // StructuredOutput (even after the runtime's in-conversation nudge) can
    // cause agent() to THROW rather than resolve to null (#332). Treat that
    // the same way we already treat a null result: retryable, subject to the
    // same dirty-worktree guard, never allowed to escape and crash the lane.
    let threw = false
    let caughtMessage = ''
    try {
      lastResult = await agentFn(prompt, opts)
    } catch (err) {
      threw = true
      caughtMessage = err instanceof Error ? err.message : String(err)
      lastResult = null
    }

    if (!threw && lastResult !== null) return lastResult

    if (threw) {
      logFn(`[resilientAgent] attempt ${attempt + 1} threw: ${caughtMessage} — treating as retryable`)
    } else if (attempt < maxRetries) {
      // Name the empty attempt: a retry that later succeeds otherwise hides
      // that the first agent finished a tool call and stopped (caliper task-007).
      logFn(`[resilientAgent] attempt ${attempt + 1} returned nothing (null result) — retrying`)
    }

    // If a worktree was provided, check for dirty state before retrying —
    // a null result (or a thrown error) after file writes means the agent
    // partially completed and a blind replay would duplicate work or create
    // extra commits.
    // The guard is a datum-cli batch (shared/commit-steps.ts), never a runner
    // told to "Run: git status" and echo the output: an echoed "" — or a null
    // reply — for a dirty tree let the retry replay onto half-applied edits.
    // Unknown state (missing batch, git error) is never treated as clean.
    if (attempt < maxRetries && opts?.worktree) {
      const guardSteps = worktreeDirtySteps(opts.worktree)
      const guard = worktreeDirtyFromSteps(parseBatchResult(
        await agentFn(batchCommandPrompt(guardSteps), stageOpts('cli', { label: 'retry-guard', model: 'haiku' })),
        guardSteps,
      ))
      if (!guard.known) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : 'returned null'} and the worktree state is unknown (${guard.detail}) — aborting retry to prevent duplicate writes`)
        return lastResult
      }
      if (guard.dirty) {
        logFn(`[resilientAgent] attempt ${attempt + 1} ${threw ? `threw: ${caughtMessage}` : 'returned null'} but worktree is dirty — aborting retry to prevent duplicate writes (${guard.detail})`)
        return lastResult
      }
    }

    if (attempt < maxRetries) {
      // Deterministic jitter: the Workflow runtime throws on Math.random()
      // (it would break resume), which would have killed the run on the
      // very retry meant to recover it. Spread by attempt index instead.
      const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt)
        + ((attempt + 1) * 7919) % RATE_LIMIT_JITTER_MS
      const reason = threw ? `threw: ${caughtMessage}` : 'returned null'
      logFn(`[resilientAgent] attempt ${attempt + 1} ${reason}, backing off ${Math.round(delay / 1000)}s before retry ${attempt + 2}/${maxRetries + 1}`)
      await sleepMs(delay)
    }
  }

  return lastResult
}



// ── Batched command runner with ONE refusal retry ───────────────────────────
// elonchesd wf_0593c210-f04: three byte-identical reset-to-red batches in one
// run, one allowed and two refused by the host permission classifier under
// the same allow-rule. A refusal is a coin flip, not a verdict on the
// commands, so a refused batch is re-sent once to a fresh runner (the prompt
// gets a retry marker so the workflow cache does not replay the refusal).
// Anything else — a parsed batch, a non-refusal prose reply, a null — is
// returned as-is for the caller's named handling.
export interface RunBatchDeps {
  agentFn?: (prompt: string, opts?: AgentOpts) => Promise<unknown>
  logFn?: (message: string) => void
}

/**
 * Scripts over this size go to the balanced model. caliper eedom
 * wf_8c7ccdb5-11d (#566): a 24 KB lane-plan batch through the fast runner
 * came back with " on purpose" inserted into a description string; the sha
 * guard caught it, but at that size a fast-model transcription slip is
 * near-certain and a retry mostly fails twice. The threshold is on the
 * PROMPT bytes (script + wrapper + instructions), the thing the runner types.
 */
export const LARGE_BATCH_BYTES = 8 * 1024

export async function runBatch(steps: BatchStep[], opts: AgentOpts & { label?: string }, deps?: RunBatchDeps): Promise<BatchResult> {
  const agentFn = deps?.agentFn ?? agent
  const logFn = deps?.logFn ?? log
  const prompt = batchCommandPrompt(steps)
  const promptBytes = utf8ByteLength(prompt)
  if (promptBytes > LARGE_BATCH_BYTES && opts.model !== model('balanced') && opts.model !== model('deep')) {
    logFn(`[runBatch] ${opts.label || 'batch'}: ${promptBytes}-byte script routed to the balanced model (over ${LARGE_BATCH_BYTES} bytes, a fast-runner transcription slip is likely)`)
    opts = { ...opts, model: model('balanced') }
  }
  let result = parseBatchResult(await agentFn(prompt, opts), steps)
  const label = opts.label || 'batch'
  const retryOpts = { ...opts, label: `${label}:retry` }
  // One retry, whatever the runner-side cause. Each is a failure of the
  // runner, not a verdict on the commands:
  //  - a host classifier refusal (elonchesd wf_0593c210-f04: one of three
  //    identical batches allowed);
  //  - a re-typed script the hash check refused (caliper wf_4f739141-c8c);
  //  - an empty reply (elonchesd wf_dee84cc2-e64: the post-GREEN verify
  //    returned nothing and the lane read exit=null as a red suite).
  if (result.missing && result.refusal && isRunnerRefusal(result.refusal)) {
    logFn(`[runBatch] ${label}: runner_permission_denied on attempt 1 ("${result.refusal.replace(/\s+/g, ' ').slice(0, 120)}") — retrying once with a fresh runner`)
    result = parseBatchResult(await agentFn(`${prompt}\n\n# attempt 2 of 2 — the previous runner refused this batch`, retryOpts), steps)
  } else if (result.missing && result.corrupt) {
    // elonchesd player-guidance wf_6cb9491b-36b task-007/016: a fresh FAST
    // runner dropped the same quote in the same place both times. A slip
    // the model class repeats is not a coin flip; the retry goes to the
    // balanced model, which transcribes what the fast one cannot.
    logFn(`[runBatch] ${label}: batch_script_corrupt on attempt 1 (${result.corrupt}) — retrying once on the balanced model`)
    result = parseBatchResult(await agentFn(`${prompt}\n\n# attempt 2 of 2 — the previous runner mistyped this script; copy it exactly`, { ...retryOpts, model: model('balanced') }), steps)
  } else if (result.missing && !result.refusal && !result.scriptError) {
    logFn(`[runBatch] ${label}: runner_empty_result on attempt 1 (the runner returned nothing parseable) — retrying once with a fresh runner`)
    result = parseBatchResult(await agentFn(`${prompt}\n\n# attempt 2 of 2 — the previous runner returned nothing; return the script's stdout`, retryOpts), steps)
  } else if (result.missing && result.scriptError?.startsWith('batch_script_failed')) {
    // wf_d913ace6-62c boot: the host shell refused the script (exit 126, no
    // stderr) — a runner-side refusal like the classifier's, retried once.
    // The refusal is intermittent by nature (datum self-hosted: refused twice,
    // ran on the third fresh runner, about a dozen boots this week), so it
    // gets a second retry; a third refusal is terminal under its name.
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 — retrying with a fresh runner (up to two retries)`)
    result = parseBatchResult(await agentFn(`${prompt}\n\n# attempt 2 of 3 — the previous runner's shell refused to execute the script; run it again`, retryOpts), steps)
    if (result.missing && result.scriptError?.startsWith('batch_script_failed')) {
      logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 2 — last retry with a fresh runner`)
      result = parseBatchResult(await agentFn(`${prompt}\n\n# attempt 3 of 3 — two runners' shells refused to execute the script; run it again`, { ...opts, label: `${label}:retry2` }), steps)
    }
  } else if (result.missing && result.scriptError?.startsWith('batch_timeout')) {
    // #496: the runner's shell cut a full-suite verify at the Bash tool's
    // two-minute default. One retry, with the timeout instruction repeated.
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 — retrying once with the timeout instruction repeated`)
    result = parseBatchResult(await agentFn(`${prompt}\n\n# attempt 2 of 2 — the previous runner's shell cut the script short; call the Bash tool with timeout 600000 and let the script finish`, retryOpts), steps)
  } else if (result.missing && /^batch_(root_missing|tool_missing)/.test(result.scriptError || '')) {
    // wf_2581bc04-604 boot: the host refused the script (exit 126) and the
    // runner then wrote the guard's row itself, copied from the script text.
    // A guard row cannot be told from a forged one, so it earns one fresh
    // retry; a real missing root or tool says so again and that is terminal.
    logFn(`[runBatch] ${label}: ${result.scriptError} on attempt 1 — retrying once with a fresh runner (a guard row is not trusted until it repeats)`)
    result = parseBatchResult(await agentFn(`${prompt}\n\n# attempt 2 of 2 — run the script exactly; if its guard prints a row, return that row, never one you wrote`, retryOpts), steps)
  }
  return result
}
