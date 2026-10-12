// nodeShell: the real subprocess shell injected into runBundle. Runs a script
// with bash in the given cwd, captures stdout and stderr, and rejects with a
// 'timeout' error (after killing the whole process group) when the script
// outlives timeoutMs.

import { spawn } from 'node:child_process'
import type { ShellFn } from './runner'

export const nodeShell: ShellFn = (script, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', script], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      finish(() => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
        reject(new Error(`shell timeout after ${opts.timeoutMs}ms`))
      })
    }, opts.timeoutMs)

    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code, signal) =>
      finish(() => resolve({ exit_code: code ?? (signal ? 128 : 1), stdout, stderr })),
    )
  })
