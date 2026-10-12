// DAT-1 — runBatch gets a non-LLM shell seam. When a `shell` primitive is
// available (deps.shell, else the ambient globalThis.shell) runBatch runs the
// batch script through it directly: no runner subagent, no prompt, no retry
// ladder. getBatchRoot() exposes the root recorded by setBatchRoot so the
// shell's cwd matches the root guard the script itself carries.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runBatch, type RunBatchDeps } from './agents'
import * as batchModule from './batch'
import { batchScript, batchCommandPrompt, setBatchRoot, BATCH_TOOL_TIMEOUT_MS } from './batch'
import { configureAgentTypes } from './agent-types'

type ShellResult = { exit_code: number; stdout: string; stderr: string }
type ShellOpts = { cwd: string; timeoutMs: number }
type ShellFn = (script: string, opts: ShellOpts) => Promise<ShellResult>

// RunBatchDeps has no `shell` yet (that is what DAT-1 adds); the cast keeps
// this file compiling against today's type.
// logFn is always supplied: the default is the sandbox-ambient `log`, which does not exist under vitest.
const withShell = (d: { shell?: ShellFn; agentFn?: (p: string, o?: unknown) => Promise<unknown> }) => ({ logFn: () => {}, ...d }) as unknown as RunBatchDeps
const getBatchRoot = (): string => (batchModule as unknown as { getBatchRoot: () => string }).getBatchRoot()

const steps = [
  { name: 'one', command: 'echo 1' },
  { name: 'two', command: 'echo 2' },
  { name: 'three', command: 'echo 3' },
]
const rows = JSON.stringify(steps.map((s, i) => ({ name: s.name, exit_code: 0, stdout: `${i + 1}\n`, stderr: '' })))
const okShell = () => vi.fn<ShellFn>(async () => ({ exit_code: 0, stdout: rows, stderr: '' }))

beforeEach(() => { configureAgentTypes({}); setBatchRoot('') })
afterEach(() => { setBatchRoot(''); delete (globalThis as any).shell; delete (globalThis as any).args })

describe('sandbox.d.ts — optional global shell (AC1)', () => {
  const ambient = resolve(__dirname, 'sandbox.d.ts')
  const tsc = resolve(process.cwd(), 'node_modules/.bin/tsc')
  const check = (body: string): { ok: boolean; out: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'dat1-shell-'))
    try {
      const file = join(dir, 'fixture.ts')
      writeFileSync(file, body)
      execFileSync(tsc, ['--noEmit', '--strict', '--skipLibCheck', '--target', 'es2022', '--moduleResolution', 'bundler', '--module', 'esnext', ambient, file], { encoding: 'utf8', stdio: 'pipe' })
      return { ok: true, out: '' }
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string }
      return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }

  it('accepts a guarded call with { cwd, timeoutMs } and a { exit_code, stdout, stderr } result', () => {
    const r = check([
      'export async function f(): Promise<number | undefined> {',
      '  if (typeof shell === "undefined" || !shell) return undefined',
      '  const out: { exit_code: number; stdout: string; stderr: string } = await shell("echo hi", { cwd: "/x", timeoutMs: 1000 })',
      '  return out.exit_code',
      '}',
    ].join('\n'))
    expect(r.out).toBe('')
    expect(r.ok).toBe(true)
  }, 60000)

  it('rejects a call whose opts omit timeoutMs', () => {
    const r = check([
      'export async function f() {',
      '  if (typeof shell === "undefined" || !shell) return undefined',
      '  return shell("echo hi", { cwd: "/x" })',
      '}',
    ].join('\n'))
    expect(r.ok).toBe(false)
    expect(r.out).toContain('timeoutMs')
  }, 60000)
})

describe('getBatchRoot (AC2)', () => {
  it('returns the value last passed to setBatchRoot', () => {
    setBatchRoot('/x/repo')
    expect(getBatchRoot()).toBe('/x/repo')
    setBatchRoot('/y/other')
    expect(getBatchRoot()).toBe('/y/other')
  })

  it('returns an empty string after setBatchRoot with whitespace only', () => {
    setBatchRoot('/x/repo')
    setBatchRoot('   ')
    expect(getBatchRoot()).toBe('')
  })
})

describe('runBatch with a shell seam', () => {
  it('parses the shell stdout into 3 steps and never calls the agent (AC3)', async () => {
    const shell = okShell()
    const agentFn = vi.fn(async () => 'should not be called')
    const r = await runBatch(steps, { label: 'shell-ok' }, withShell({ shell, agentFn }))
    expect(r.missing).toBe(false)
    expect(r.failed).toBeNull()
    expect(r.steps.map((s) => s.name)).toEqual(['one', 'two', 'three'])
    expect(r.steps.map((s) => s.stdout)).toEqual(['1\n', '2\n', '3\n'])
    expect(agentFn.mock.calls.length).toBe(0)
  })

  it('calls the shell once with batchScript(steps), the batch root as cwd and the 600000ms timeout (AC4)', async () => {
    setBatchRoot('/x/repo')
    const shell = okShell()
    await runBatch(steps, { label: 'shell-args' }, withShell({ shell, agentFn: vi.fn() }))
    expect(shell.mock.calls.length).toBe(1)
    const [script, opts] = shell.mock.calls[0]
    expect(script).toBe(batchScript(steps))
    expect(opts.cwd).toBe(getBatchRoot())
    expect(opts.cwd).toBe('/x/repo')
    expect(opts.timeoutMs).toBe(600000)
    expect(opts.timeoutMs).toBe(BATCH_TOOL_TIMEOUT_MS)
  })

  it('with an empty batch root, cwd falls back to args.repoRoot (AC5)', async () => {
    ;(globalThis as any).args = { repoRoot: '/from/args' }
    const shell = okShell()
    await runBatch(steps, { label: 'cwd-args' }, withShell({ shell, agentFn: vi.fn() }))
    expect(shell.mock.calls.length).toBe(1)
    expect(shell.mock.calls[0][1].cwd).toBe('/from/args')
  })

  it('with an empty batch root and no args.repoRoot, cwd falls back to process.cwd() (AC5)', async () => {
    ;(globalThis as any).args = {}
    const shell = okShell()
    await runBatch(steps, { label: 'cwd-process' }, withShell({ shell, agentFn: vi.fn() }))
    expect(shell.mock.calls.length).toBe(1)
    expect(shell.mock.calls[0][1].cwd).toBe(process.cwd())
  })

  it('prefers deps.shell over globalThis.shell (AC6)', async () => {
    const globalShell = okShell()
    ;(globalThis as any).shell = globalShell
    const depsShell = okShell()
    try {
      const agentFn = vi.fn()
      const r = await runBatch(steps, { label: 'precedence' }, withShell({ shell: depsShell, agentFn }))
      expect(r.steps.length).toBe(3)
      expect(depsShell.mock.calls.length).toBe(1)
      expect(globalShell.mock.calls.length).toBe(0)
      expect(agentFn.mock.calls.length).toBe(0)
    } finally {
      delete (globalThis as any).shell
    }
  })

  it('uses globalThis.shell when deps carries none (AC6)', async () => {
    const globalShell = okShell()
    ;(globalThis as any).shell = globalShell
    try {
      const agentFn = vi.fn()
      const r = await runBatch(steps, { label: 'global-shell' }, withShell({ agentFn }))
      expect(r.steps.length).toBe(3)
      expect(globalShell.mock.calls.length).toBe(1)
      expect(agentFn.mock.calls.length).toBe(0)
    } finally {
      delete (globalThis as any).shell
    }
  })

  it('a rejecting shell yields missing with batch_shell_threw and no agent call or retry (AC7)', async () => {
    const shell = vi.fn<ShellFn>(async () => { throw new Error('boom') })
    const agentFn = vi.fn()
    const r = await runBatch(steps, { label: 'shell-throws' }, withShell({ shell, agentFn }))
    expect(r.missing).toBe(true)
    expect(r.scriptError?.startsWith('batch_shell_threw: boom')).toBe(true)
    expect(agentFn.mock.calls.length).toBe(0)
    expect(shell.mock.calls.length).toBe(1)
  })

  it('a non-zero exit with unparseable stdout yields batch_shell_exit_3 with the first 200 stderr chars (AC8)', async () => {
    const shell = vi.fn<ShellFn>(async () => ({ exit_code: 3, stdout: 'not json at all', stderr: 'x'.repeat(500) }))
    const agentFn = vi.fn()
    const r = await runBatch(steps, { label: 'shell-exit' }, withShell({ shell, agentFn }))
    expect(r.missing).toBe(true)
    expect(r.scriptError).toBe('batch_shell_exit_3: ' + 'x'.repeat(200))
    expect(agentFn.mock.calls.length).toBe(0)
    expect(shell.mock.calls.length).toBe(1)
  })
})

describe('runBatch without a shell (AC9)', () => {
  it('sends batchCommandPrompt(steps) to agentFn exactly as before', async () => {
    expect((globalThis as any).shell).toBeUndefined()
    const prompts: string[] = []
    const r = await runBatch(steps, { label: 'no-shell' }, {
      agentFn: async (prompt) => { prompts.push(prompt); return rows },
      logFn: () => {},
    })
    expect(r.missing).toBe(false)
    expect(r.steps.length).toBe(3)
    expect(prompts).toEqual([batchCommandPrompt(steps)])
  })
})
