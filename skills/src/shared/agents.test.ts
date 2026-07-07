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
