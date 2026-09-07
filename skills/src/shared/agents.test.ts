// Tests for #332 — resilientAgent must treat a THROWN error from agent()
// (e.g. "subagent completed without calling StructuredOutput after
// in-conversation nudge") the same way it already treats a null result:
// retryable, subject to the dirty-worktree guard, and never allowed to
// escape and crash the caller (runLane() et al).
//
// `agent`/`log` are sandbox-ambient globals (see shared/sandbox.d.ts) that
// are not available/mockable in a plain vitest run. resilientAgent accepts
// an optional ResilientAgentDeps override (agentFn/logFn) specifically so
// this retry/backoff/dirty-guard logic can be exercised here without the
// sandbox runtime. Production call sites never pass deps, so behavior for
// real callers is unchanged.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resilientAgent, runBatch, LARGE_BATCH_BYTES } from './agents'
import { model } from './models'
import { describeFailure } from './batch'
import { configureAgentTypes } from './agent-types'

// resilientAgent's dirty-worktree guard routes through stageOpts('cli'),
// which refuses to run before a script has configured the switches.
beforeEach(() => configureAgentTypes({}))

describe('runBatch — one retry on a runner refusal', () => {
  const steps = [{ name: 'reset', command: 'git reset --hard abc' }]
  const arr = JSON.stringify([{ name: 'reset', exit_code: 0, stdout: '', stderr: '' }])

  it('re-sends a refused batch once with a fresh label and a retry marker in the prompt', async () => {
    const prompts: string[] = []
    const labels: string[] = []
    const logs: string[] = []
    let n = 0
    const r = await runBatch(steps, { label: 'reset-to-red:T1' }, {
      agentFn: async (prompt, opts) => { prompts.push(prompt); labels.push(opts?.label || ''); return ++n === 1 ? 'The permission classifier blocked execution of git reset --hard.' : arr },
      logFn: (m) => logs.push(m),
    })
    expect(r.missing).toBe(false)
    expect(labels).toEqual(['reset-to-red:T1', 'reset-to-red:T1:retry'])
    expect(prompts[1]).not.toBe(prompts[0])
    expect(prompts[1]).toContain('attempt 2 of 2')
    expect(logs.some((l) => /runner_permission_denied on attempt 1/.test(l))).toBe(true)
  })

  it('does not retry a parsed batch or a non-refusal prose reply (a null IS retried: runner_empty_result)', async () => {
    for (const reply of [arr, 'Here is a summary of the output.']) {
      let calls = 0
      await runBatch(steps, { label: 'x' }, { agentFn: async () => { calls++; return reply }, logFn: () => undefined })
      expect(calls).toBe(1)
    }
  })

  it('a second refusal is returned as the refusal for the caller to name', async () => {
    const r = await runBatch(steps, { label: 'x' }, { agentFn: async () => 'Bash was blocked by the classifier.', logFn: () => undefined })
    expect(r.missing).toBe(true)
    expect(describeFailure(r, 'x')).toMatch(/^x: runner_permission_denied/)
  })
})

describe('resilientAgent', () => {
  // caliper task-007: the first reflect attempt returned nothing and only the
  // retry's outcome was visible. A null attempt is logged by name.
  it('logs a null attempt by name before retrying', async () => {
    vi.useFakeTimers()
    try {
      const logs: string[] = []
      let calls = 0
      const pending = resilientAgent('p', { maxRetries: 1 }, {
        agentFn: async () => (++calls === 1 ? null : { ok: true }),
        logFn: (m: string) => logs.push(m),
      })
      await vi.runAllTimersAsync()
      const r = await pending
      expect(r).toEqual({ ok: true })
      expect(logs.some((l) => /\[resilientAgent\] attempt 1 returned nothing \(null result\) — retrying/.test(l))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers when agent() throws on the first attempt and succeeds on retry', async () => {
    vi.useFakeTimers()
    try {
      const logFn = vi.fn()
      let call = 0
      const agentFn = vi.fn(async () => {
        call += 1
        if (call === 1) {
          throw new Error(
            'agent({schema}): subagent completed without calling StructuredOutput (after in-conversation nudge)',
          )
        }
        return { committed: true }
      })

      const pending = resilientAgent(
        'do the thing',
        { maxRetries: 2 },
        { agentFn, logFn },
      )
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result).toEqual({ committed: true })
      expect(agentFn).toHaveBeenCalledTimes(2)
      expect(logFn).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1 threw: agent({schema}): subagent completed without calling StructuredOutput (after in-conversation nudge) — treating as retryable'),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns null instead of throwing once retries are exhausted', async () => {
    vi.useFakeTimers()
    try {
      const logFn = vi.fn()
      const agentFn = vi.fn(async () => {
        throw new Error('subagent completed without calling StructuredOutput')
      })

      const pending = resilientAgent(
        'do the thing',
        { maxRetries: 1 },
        { agentFn, logFn },
      )
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result).toBeNull()
      expect(agentFn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  // The dirty-worktree guard is a datum-cli batch (git status --porcelain as
  // a step), never a runner told to "Run: git status" and echo the output:
  // an echo of "" for a dirty tree — or a null reply — used to let the
  // retry replay onto half-applied edits.
  const statusBatch = (stdout: string): string =>
    JSON.stringify([{ name: 'status', exit_code: 0, stdout, stderr: '' }])

  it('aborts retry when worktree is dirty after a thrown error, returning null', async () => {
    const logFn = vi.fn()
    const agentFn = vi.fn()
      // First call: the "real" prompt, throws.
      .mockImplementationOnce(async () => {
        throw new Error('stalled — no StructuredOutput')
      })
      // Second call: the dirty-worktree guard batch — report dirty.
      .mockImplementationOnce(async () => statusBatch('M some/file.ts\n'))

    const result = await resilientAgent(
      'do the thing',
      { maxRetries: 2, worktree: '/some/wt' },
      { agentFn, logFn },
    )

    expect(result).toBeNull()
    // Only the initial attempt + the dirty-guard check ran; no further retry.
    expect(agentFn).toHaveBeenCalledTimes(2)
    expect(agentFn.mock.calls[1][0]).toContain('git -C "/some/wt" status --porcelain')
    expect(logFn).toHaveBeenCalledWith(
      expect.stringContaining('worktree is dirty — aborting retry to prevent duplicate writes'),
    )
  })

  it('a guard batch that returned nothing parseable aborts the retry (unknown state is not clean)', async () => {
    const logFn = vi.fn()
    const agentFn = vi.fn()
      .mockImplementationOnce(async () => null)
      .mockImplementationOnce(async () => null)

    const result = await resilientAgent(
      'do the thing',
      { maxRetries: 2, worktree: '/some/wt' },
      { agentFn, logFn },
    )

    expect(result).toBeNull()
    expect(agentFn).toHaveBeenCalledTimes(2)
    expect(logFn).toHaveBeenCalledWith(expect.stringContaining('retry_guard_unverified'))
  })

  it('retries when the guard batch reports a clean worktree', async () => {
    vi.useFakeTimers()
    try {
      const logFn = vi.fn()
      const agentFn = vi.fn()
        .mockImplementationOnce(async () => null)
        .mockImplementationOnce(async () => statusBatch(''))
        .mockImplementationOnce(async () => ({ committed: true }))

      const pending = resilientAgent('do the thing', { maxRetries: 2, worktree: '/some/wt' }, { agentFn, logFn })
      await vi.runAllTimersAsync()
      const result = await pending

      expect(result).toEqual({ committed: true })
      expect(agentFn).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('still returns the result unchanged when agent() resolves normally (no throw)', async () => {
    const agentFn = vi.fn(async () => ({ committed: true, commit_sha: 'abc123' }))

    const result = await resilientAgent('do the thing', {}, { agentFn, logFn: vi.fn() })

    expect(result).toEqual({ committed: true, commit_sha: 'abc123' })
    expect(agentFn).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// verifyCommitIndependently — the "did the agent really commit?" check ran
// an UNBOUNDED `git log --format="%H %s"` through an LLM relay (the same
// 90 KB truncation hazard that broke lane intake, commit 726dbd8) and
// hard-coded model 'haiku'. It must run as a datum-cli batch with the log
// bounded to the lane (`<base>..HEAD`), and the decision must be a pure,
// testable parser over the two steps' stdout.
// ---------------------------------------------------------------------------

import { readFileSync as _rf } from 'node:fs'
import { join as _join } from 'node:path'
import { parseCommitVerification } from './agents'

describe('verifyCommitIndependently is a bounded deterministic batch', () => {
  const src = _rf(_join(__dirname, 'agents.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function verifyCommitIndependently'), src.indexOf('export interface ResilientAgentDeps'))

  it('uses batchCommandPrompt/parseBatchResult and bounds the log to the lane', () => {
    expect(fn).toMatch(/batchCommandPrompt\(/)
    expect(fn).toMatch(/parseBatchResult\(/)
    expect(fn).toMatch(/\.\.HEAD|-n \d+/)
    expect(fn).not.toMatch(/model: 'haiku'/)
  })
})

describe('parseCommitVerification', () => {
  const log = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa green(T1): GREEN complete\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb red(T1): RED complete\n'

  it('finds the stage commit anywhere in the lane log and reports clean when status is empty', () => {
    const r = parseCommitVerification(log, '', 'red(T1)', 'RED')
    expect(r.committed).toBe(true)
    expect(r.commitSha).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    expect(r.clean).toBe(true)
  })

  it('is not committed when uncommitted changes remain in the lane files', () => {
    const r = parseCommitVerification(log, ' M tests/test_a.py\n', 'red(T1)', 'RED')
    expect(r.committed).toBe(false)
    expect(r.clean).toBe(false)
    expect(r.detail).toMatch(/uncommitted_files=1/)
  })

  it('reports a missing commit with the target subject in the detail', () => {
    const r = parseCommitVerification(log, '', 'green(T2)', 'GREEN')
    expect(r.committed).toBe(false)
    expect(r.detail).toMatch(/green\(T2\): GREEN complete/)
  })

  it('a null log (step did not run) is not committed and says so', () => {
    const r = parseCommitVerification(null, null, 'red(T1)', 'RED')
    expect(r.committed).toBe(false)
    expect(r.detail).toMatch(/no result|did not run/i)
  })
})

// caliper eedom wf_4f739141-c8c: a runner that mistyped the batch script is
// now a named batch_script_corrupt result (shared/batch.ts). Like a refusal,
// it is re-sent once with a fresh runner before the caller sees it.
describe('runBatch — one retry on a corrupt (mistyped) script', () => {
  const steps = [{ name: 'a', command: 'echo hi', tolerant: true }]
  const corrupt = JSON.stringify([{ name: '__script', exit_code: 1, stdout: '', stderr: 'batch_script_corrupt: expected 0000000000000000000000000000000000000000, got 1111111111111111111111111111111111111111' }])
  const good = JSON.stringify([{ name: 'a', exit_code: 0, stdout: 'hi\n', stderr: '' }])

  it('re-sends the batch once and returns the second result', async () => {
    let calls = 0
    const logs: string[] = []
    const r = await runBatch(steps, { label: 'setup' }, {
      agentFn: async () => { calls++; return calls === 1 ? corrupt : good },
      logFn: (m: string) => { logs.push(m) },
    })
    expect(calls).toBe(2)
    expect(r.missing).toBe(false)
    expect(logs.join('\n')).toMatch(/\[runBatch\] setup: batch_script_corrupt on attempt 1/)
  })

  it('gives up after the second corrupt result, keeping it named', async () => {
    const r = await runBatch(steps, { label: 'setup' }, { agentFn: async () => corrupt, logFn: () => undefined })
    expect(r.missing).toBe(true)
    expect(describeFailure(r, 'setup')).toMatch(/batch_script_corrupt/)
  })
})

// caliper eedom wf_8c7ccdb5-11d (#566): a 24 KB lane-plan batch through the
// fast runner came back with " on purpose" inserted into a description
// string — the sha guard caught it, but at that size a transcription slip is
// near-certain, so a retry mostly fails twice. A batch whose prompt exceeds
// LARGE_BATCH_BYTES is routed to the balanced model instead, and says so.
describe('runBatch — large scripts go to the balanced model', () => {
  const ok = JSON.stringify([{ name: 'w', exit_code: 0, stdout: '', stderr: '' }])
  it('a prompt over the threshold is sent with the balanced model and logged', async () => {
    const big = [{ name: 'w', command: `cat > x <<'EOF'\n${'y'.repeat(LARGE_BATCH_BYTES + 100)}\nEOF` }]
    const models: (string | undefined)[] = []
    const logs: string[] = []
    const r = await runBatch(big, { label: 'build-lane-plan', model: 'fast-model' }, {
      agentFn: async (_p, o) => { models.push(o?.model); return ok },
      logFn: (m) => logs.push(m),
    })
    expect(r.missing).toBe(false)
    expect(models).toEqual([model('balanced')])
    expect(logs.some((l) => /\[runBatch\] build-lane-plan: \d+-byte script routed to the balanced model/.test(l))).toBe(true)
  })
  it('a small prompt keeps the caller\'s model', async () => {
    const models: (string | undefined)[] = []
    await runBatch([{ name: 'w', command: 'echo 1' }], { label: 'x', model: 'fast-model' }, {
      agentFn: async (_p, o) => { models.push(o?.model); return ok },
      logFn: () => undefined,
    })
    expect(models).toEqual(['fast-model'])
  })
})

// elonchesd datum/player-guidance wf_dee84cc2-e64 task-001: the post-GREEN
// verify batch returned NOTHING (agents_empty_result), the lane read
// exit=null as green_verify_failed and triage filed it as "GREEN lied";
// the committed GREEN passed 434/434 in a scratch worktree. An empty reply
// is a runner failure like a refusal: re-sent once, then named.
describe('runBatch — one retry on an empty reply, named runner_empty_result', () => {
  const steps = [{ name: 'test-verify', command: 'npm test' }]
  const ok = JSON.stringify([{ name: 'test-verify', exit_code: 0, stdout: 'TEST_EXIT=0\n', stderr: '' }])
  it('re-sends once with a fresh label and a retry marker; the second reply is used', async () => {
    const labels: string[] = []
    const logs: string[] = []
    let n = 0
    const r = await runBatch(steps, { label: 'post-green-verify:T1', model: 'm' }, {
      agentFn: async (_p, o) => { labels.push(o?.label || ''); return n++ === 0 ? null : ok },
      logFn: (m) => logs.push(m),
    })
    expect(r.missing).toBe(false)
    expect(labels).toEqual(['post-green-verify:T1', 'post-green-verify:T1:retry'])
    expect(logs.some((l) => /\[runBatch\] post-green-verify:T1: runner_empty_result on attempt 1/.test(l))).toBe(true)
  })
  it('treats an empty code fence ("``` ```", wf_aec6a61b-94a task-007) as an empty reply and retries', async () => {
    const labels: string[] = []
    let n = 0
    const r = await runBatch(steps, { label: 'lane-intake:T7', model: 'm' }, {
      agentFn: async (_p, o) => { labels.push(o?.label || ''); return n++ === 0 ? '``` ```' : ok },
      logFn: () => undefined,
    })
    expect(r.missing).toBe(false)
    expect(labels).toEqual(['lane-intake:T7', 'lane-intake:T7:retry'])
  })
  it('gives up after a second empty reply and names it', async () => {
    const r = await runBatch(steps, { label: 'post-green-verify:T1', model: 'm' }, { agentFn: async () => null, logFn: () => undefined })
    expect(r.missing).toBe(true)
    expect(describeFailure(r, 'post-green-verify')).toMatch(/^post-green-verify: runner_empty_result — batch agent returned no parseable result/)
  })
})

// elonchesd player-guidance wf_6cb9491b-36b task-007/task-016: the corrupt
// retry went to a fresh FAST runner, which dropped the same quote in the
// same place both times. A transcription slip repeated by the same model
// class is not a coin flip; the retry goes to the balanced model.
describe('runBatch — the corrupt-script retry goes to the balanced model', () => {
  it('re-sends a mistyped script with model("balanced"), not the caller\'s fast model', async () => {
    const steps = [{ name: 'a', command: 'echo a' }]
    const corrupt = JSON.stringify([{ name: '__script', exit_code: 1, stdout: '', stderr: 'batch_script_corrupt: expected 0123456789abcdef0123456789abcdef01234567, got 89abcdef0123456789abcdef0123456789abcdef' }])
    const ok = JSON.stringify([{ name: 'a', exit_code: 0, stdout: 'a\n', stderr: '' }])
    const models: (string | undefined)[] = []
    let n = 0
    const r = await runBatch(steps, { label: 'post-green-verify:T7', model: 'fast-model' }, {
      agentFn: async (_p, o) => { models.push(o?.model); return n++ === 0 ? corrupt : ok },
      logFn: () => undefined,
    })
    expect(r.missing).toBe(false)
    expect(models).toEqual(['fast-model', model('balanced')])
  })
})

// wf_d913ace6-62c boot: the host shell refused the script (exit 126, no
// stderr) twice in a row, and intermittently across launches. A refusal of
// this kind is a runner-side failure like the other three: one fresh retry.
describe('runBatch — two retries on batch_script_failed (the host refused the script)', () => {
  // datum self-hosted, ~a dozen boots this week: the host refuses the boot
  // script with exit 126 twice in a row and a third fresh runner runs it.
  // One retry was too few for a refusal that is intermittent by nature.
  const steps = [{ name: 'cfg', command: 'cat .datum/config.json' }]
  const refused = JSON.stringify([{ name: '__script', exit_code: 126, stdout: '', stderr: '' }])
  const ok = JSON.stringify([{ name: 'cfg', exit_code: 0, stdout: '{}', stderr: '' }])
  it('re-sends up to twice and uses the first reply that ran', async () => {
    const labels: string[] = []
    let n = 0
    const r = await runBatch(steps, { label: 'boot', model: 'm' }, {
      agentFn: async (_p, o) => { labels.push(o?.label || ''); return n++ < 2 ? refused : ok },
      logFn: () => undefined,
    })
    expect(r.missing).toBe(false)
    expect(labels).toEqual(['boot', 'boot:retry', 'boot:retry2'])
  })
  it('names a third refusal batch_script_failed with the exit code', async () => {
    let n = 0
    const r = await runBatch(steps, { label: 'boot', model: 'm' }, { agentFn: async () => { n++; return refused }, logFn: () => undefined })
    expect(n).toBe(3)
    expect(describeFailure(r, 'boot')).toMatch(/^boot: batch_script_failed: the batch script exited 126/)
  })
})

// wf_2581bc04-604 boot: the host refused the script twice (exit 126) and the
// runner then wrote a `batch_root_missing` row itself, copying the guard's
// text out of the script. A guard row cannot be told from a forged one, so
// it earns one fresh retry like a corrupt script; a real missing root says
// so again on the second attempt and that answer is terminal.
describe('runBatch — one retry on a guard row (batch_root_missing / batch_tool_missing)', () => {
  const steps = [{ name: 'cfg', command: 'cat .datum/config.json' }]
  const forged = JSON.stringify([{ name: '__script', exit_code: 1, stdout: '', stderr: 'batch_root_missing: /Volumes/Extra/repos/gitrdunhq/datum' }])
  const ok = JSON.stringify([{ name: 'cfg', exit_code: 0, stdout: '{}', stderr: '' }])
  it('re-sends once and uses the second reply', async () => {
    const labels: string[] = []
    let n = 0
    const r = await runBatch(steps, { label: 'boot', model: 'm' }, {
      agentFn: async (_p, o) => { labels.push(o?.label || ''); return n++ === 0 ? forged : ok },
      logFn: () => undefined,
    })
    expect(r.missing).toBe(false)
    expect(labels).toEqual(['boot', 'boot:retry'])
  })
  it('a second guard row is terminal and keeps the guard name', async () => {
    const r = await runBatch(steps, { label: 'boot', model: 'm' }, { agentFn: async () => forged, logFn: () => undefined })
    expect(describeFailure(r, 'boot')).toMatch(/^boot: batch_root_missing: \/Volumes/)
  })
})

// #496: a timed-out batch is re-sent once with the timeout instruction
// repeated; a second timeout is terminal under its own name.
describe('runBatch — one retry on batch_timeout', () => {
  const steps = [{ name: 'test-verify', command: 'uv run pytest -x -q' }]
  const timedOut = 'The command timed out after 120 seconds and did not produce output.'
  const ok = JSON.stringify([{ name: 'test-verify', exit_code: 0, stdout: 'TEST_EXIT=0', stderr: '' }])
  it('re-sends once, repeating the timeout instruction, and uses the second reply', async () => {
    const prompts: string[] = []
    let n = 0
    const r = await runBatch(steps, { label: 'post-red', model: 'm' }, {
      agentFn: async (p) => { prompts.push(p); return n++ === 0 ? timedOut : ok },
      logFn: () => undefined,
    })
    expect(r.missing).toBe(false)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toMatch(/attempt 2 of 2[\s\S]*600000/)
  })
  it('a second timeout is terminal as batch_timeout', async () => {
    const r = await runBatch(steps, { label: 'post-red', model: 'm' }, { agentFn: async () => timedOut, logFn: () => undefined })
    expect(describeFailure(r, 'post-red')).toMatch(/^post-red: batch_timeout: /)
  })
})

