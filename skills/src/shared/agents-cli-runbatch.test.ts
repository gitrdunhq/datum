// DAT-2 — verifyCommitIndependently and resilientAgent's dirty-worktree guard
// go through runBatch (the shell seam when present, the runner subagent
// otherwise), and runBatch gains a retryMarker option so the context-relay's
// second inline attempt keeps its distinct prompt without a hand-built one.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runBatch, verifyCommitIndependently, resilientAgent, type RunBatchDeps } from './agents'
import { batchScript, batchCommandPrompt, setBatchRoot } from './batch'
import { worktreeDirtySteps } from './commit-steps'
import { CONTEXT_INLINE_RETRY_MARKER } from './context-relay'
import { configureAgentTypes } from './agent-types'
import { model } from './models'

type ShellResult = { exit_code: number; stdout: string; stderr: string }
type ShellFn = (script: string, opts: { cwd: string; timeoutMs: number }) => Promise<ShellResult>

const SHA = 'a'.repeat(40)
const g = globalThis as Record<string, unknown>

/** A shell whose batch rows are `rows` (name -> stdout), every step exit 0. */
const shellReturning = (rows: Record<string, string>) =>
  vi.fn<ShellFn>(async () => ({
    exit_code: 0,
    stdout: JSON.stringify(Object.entries(rows).map(([name, stdout]) => ({ name, exit_code: 0, stdout, stderr: '' }))),
    stderr: '',
  }))

beforeEach(() => { configureAgentTypes({}); setBatchRoot('') })
afterEach(() => { setBatchRoot(''); delete g.shell; delete g.agent; delete g.log })

describe('verifyCommitIndependently through runBatch', () => {
  it('reaches the shell, returns committed:true on a matching log row, and calls the agent global 0 times (AC3)', async () => {
    const shell = shellReturning({ log: `${SHA} feat: green complete\n`, status: '' })
    const agentGlobal = vi.fn(async () => 'must not be called')
    g.shell = shell
    g.agent = agentGlobal

    const r = await verifyCommitIndependently('task-001', '/wt', ['a.ts'], 'feat', 'green')

    expect(r.committed).toBe(true)
    expect(r.commitSha).toBe(SHA)
    expect(r.clean).toBe(true)
    expect(agentGlobal.mock.calls.length).toBe(0)
    expect(shell.mock.calls.length).toBe(1)
    const script = shell.mock.calls[0][0]
    expect(script).toContain('"/wt"')
    expect(script).toContain('log --format="%H %s"')
  })

  it('bounds the shell-run log to baseRef..HEAD when a base ref is given (AC3)', async () => {
    const shell = shellReturning({ log: `${SHA} feat: green complete\n`, status: '' })
    g.shell = shell
    g.agent = vi.fn(async () => 'must not be called')

    await verifyCommitIndependently('task-001', '/wt', ['a.ts'], 'feat', 'green', 'epic/x')

    expect(shell.mock.calls[0][0]).toContain('"epic/x"..HEAD')
  })

  it('reports committed:false from the shell path when the log row has no matching commit (AC3, negative)', async () => {
    g.shell = shellReturning({ log: `${SHA} chore: unrelated\n`, status: '' })
    g.agent = vi.fn(async () => 'must not be called')

    const r = await verifyCommitIndependently('task-001', '/wt', ['a.ts'], 'feat', 'green')

    expect(r.committed).toBe(false)
    expect(r.detail).toContain('feat: green complete')
  })

  it('without a shell sends the runner the label verify-commit:<taskId>:<stage> on model("fast") (AC1)', async () => {
    const calls: Array<{ prompt: string; opts: { label?: string; model?: string } | undefined }> = []
    g.agent = vi.fn(async (prompt: string, opts?: { label?: string; model?: string }) => {
      calls.push({ prompt, opts })
      return JSON.stringify([
        { name: 'log', exit_code: 0, stdout: `${SHA} feat: green complete\n`, stderr: '' },
        { name: 'status', exit_code: 0, stdout: '', stderr: '' },
      ])
    })
    g.log = vi.fn()

    const r = await verifyCommitIndependently('task-001', '/wt', ['a.ts'], 'feat', 'green')

    expect(r.committed).toBe(true)
    expect(calls.length).toBe(1)
    expect(calls[0].opts?.label).toBe('verify-commit:task-001:green')
    expect(calls[0].opts?.model).toBe(model('fast'))
  })

  it('the function body calls runBatch( and no longer builds a batchCommandPrompt( (AC1)', () => {
    const src = readFileSync(join(__dirname, 'agents.ts'), 'utf8')
    const fn = src.slice(src.indexOf('export async function verifyCommitIndependently'), src.indexOf('export interface ResilientAgentDeps'))
    expect(fn).toContain('runBatch(')
    expect(fn).not.toContain('batchCommandPrompt(')
  })
})

describe("resilientAgent's retry-guard through runBatch (AC2)", () => {
  const wt = '/wt/lane'
  const guardSteps = worktreeDirtySteps(wt)

  it('with a shell, the guard runs batchScript(guardSteps) in the shell and agentFn only sees the real call', async () => {
    const shell = shellReturning({ status: ' M a.ts\n' })
    g.shell = shell
    const agentFn = vi.fn(async () => null)
    const logs: string[] = []

    const r = await resilientAgent('do work', { worktree: wt, maxRetries: 1 }, { agentFn, logFn: (m) => logs.push(m) })

    expect(r).toBeNull()
    expect(shell.mock.calls.length).toBe(1)
    expect(shell.mock.calls[0][0]).toBe(batchScript(guardSteps))
    expect(agentFn.mock.calls.length).toBe(1)
    expect(logs.some((l) => l.includes('worktree is dirty'))).toBe(true)
  })

  it('with a shell reporting a clean tree the guard does not abort the retry (negative path)', async () => {
    vi.useFakeTimers()
    try {
      const shell = shellReturning({ status: '' })
      g.shell = shell
      const agentFn = vi.fn(async () => null)

      const p = resilientAgent('do work', { worktree: wt, maxRetries: 1 }, { agentFn, logFn: () => {} })
      await vi.runAllTimersAsync()
      await p

      expect(shell.mock.calls.length).toBe(1)
      expect(agentFn.mock.calls.length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a shell, agentFn receives batchCommandPrompt(guardSteps) labelled retry-guard on haiku', async () => {
    const calls: Array<{ prompt: string; opts: { label?: string; model?: string } | undefined }> = []
    const agentFn = vi.fn(async (prompt: string, opts?: { label?: string; model?: string }) => { calls.push({ prompt, opts }); return null })

    await resilientAgent('do work', { worktree: wt, maxRetries: 1 }, { agentFn, logFn: () => {} })

    expect(calls.length).toBe(2)
    expect(calls[1].prompt).toBe(batchCommandPrompt(guardSteps))
    expect(calls[1].opts?.label).toBe('retry-guard')
    expect(calls[1].opts?.model).toBe('haiku')
  })

  it('an unparseable guard reply from the injected agentFn aborts the retry as unknown state (negative path)', async () => {
    const agentFn = vi.fn(async () => null)
    const logs: string[] = []

    const r = await resilientAgent('do work', { worktree: wt, maxRetries: 1 }, { agentFn, logFn: (m) => logs.push(m) })

    expect(r).toBeNull()
    expect(agentFn.mock.calls.length).toBe(2)
    expect(logs.some((l) => l.includes('worktree state is unknown'))).toBe(true)
  })
})

describe('runBatch retryMarker option', () => {
  const steps = [
    { name: 'one', command: 'echo 1' },
    { name: 'two', command: 'echo 2' },
  ]
  const rows = JSON.stringify(steps.map((s, i) => ({ name: s.name, exit_code: 0, stdout: `${i + 1}\n`, stderr: '' })))
  type WithMarker = Parameters<typeof runBatch>[1] & { retryMarker?: string }

  it('CONTEXT_INLINE_RETRY_MARKER is the exact attempt-2 instruction (AC5)', () => {
    expect(CONTEXT_INLINE_RETRY_MARKER).toBe(
      "# attempt 2 of 2 — the previous runner returned one of these files with bytes missing; copy the script's output verbatim, every byte",
    )
  })

  it('with no shell, retryMarker makes the prompt equal batchCommandPrompt(steps) plus the marker byte for byte (AC4)', async () => {
    const prompts: string[] = []
    const opts: WithMarker = { label: 'x', retryMarker: CONTEXT_INLINE_RETRY_MARKER }

    const r = await runBatch(steps, opts, {
      agentFn: async (prompt) => { prompts.push(prompt); return rows },
      logFn: () => {},
    })

    expect(r.missing).toBe(false)
    expect(prompts).toEqual([`${batchCommandPrompt(steps)}\n\n${CONTEXT_INLINE_RETRY_MARKER}`])
    expect(prompts[0]).not.toBe(batchCommandPrompt(steps))
    expect(prompts[0]).toBe(`${batchCommandPrompt(steps)}\n\n${CONTEXT_INLINE_RETRY_MARKER}`)
  })

  it('without retryMarker the prompt stays batchCommandPrompt(steps) (AC4, negative)', async () => {
    const prompts: string[] = []

    await runBatch(steps, { label: 'x' }, {
      agentFn: async (prompt) => { prompts.push(prompt); return rows },
      logFn: () => {},
    })

    expect(prompts).toEqual([batchCommandPrompt(steps)])
  })

  it('with a shell present, retryMarker is ignored and the shell receives batchScript(steps) (AC6)', async () => {
    const shell = shellReturning({ one: '1\n', two: '2\n' })
    const agentFn = vi.fn(async () => 'must not be called')
    const opts: WithMarker = { label: 'x', retryMarker: CONTEXT_INLINE_RETRY_MARKER }

    const r = await runBatch(steps, opts, { shell, agentFn, logFn: () => {} } as RunBatchDeps)

    expect(r.missing).toBe(false)
    expect(shell.mock.calls.length).toBe(1)
    expect(shell.mock.calls[0][0]).toBe(batchScript(steps))
    expect(shell.mock.calls[0][0]).not.toContain(CONTEXT_INLINE_RETRY_MARKER)
    expect(agentFn.mock.calls.length).toBe(0)
  })
})
