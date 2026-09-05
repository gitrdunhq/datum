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

import { describe, it, expect, vi } from 'vitest'
import { resilientAgent } from './agents'

describe('resilientAgent', () => {
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

  it('aborts retry when worktree is dirty after a thrown error, returning null', async () => {
    const logFn = vi.fn()
    const agentFn = vi.fn()
      // First call: the "real" prompt, throws.
      .mockImplementationOnce(async () => {
        throw new Error('stalled — no StructuredOutput')
      })
      // Second call: the dirty-worktree guard check — report dirty.
      .mockImplementationOnce(async () => 'M some/file.ts\n')

    const result = await resilientAgent(
      'do the thing',
      { maxRetries: 2, worktree: '/some/wt' },
      { agentFn, logFn },
    )

    expect(result).toBeNull()
    // Only the initial attempt + the dirty-guard check ran; no further retry.
    expect(agentFn).toHaveBeenCalledTimes(2)
    expect(logFn).toHaveBeenCalledWith(
      expect.stringContaining('worktree is dirty — aborting retry to prevent duplicate writes'),
    )
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
