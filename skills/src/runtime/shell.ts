// nodeShell: the real subprocess shell injected into runBundle. Runs a script
// with bash in the given cwd, captures stdout and stderr, and rejects with a
// 'timeout' error (after killing the whole process group) when the script
// outlives timeoutMs.
//
// Output is bounded (PERF-001, SEC-004), in UTF-16 characters (strings, so
// the module stays free of Node globals like the sandbox sources): stdout past
// maxStdoutChars kills the script and rejects with shell_output_too_large,
// because the batch protocol parses stdout whole and a truncated array would
// read as a different result; stderr keeps only its last maxStderrChars,
// marked as truncated, because it is only ever shown as a tail. The child
// keeps the parent's environment: batch steps run the operator's own tools
// (uv, git, node, the test suite), the same as the hosted Bash tool, and the
// runtime holds no API keys yet.

import { spawn } from 'node:child_process'
import type { ShellFn } from '../shared/agents'

export interface NodeShellLimits {
  maxStdoutChars?: number
  maxStderrChars?: number
}

export const DEFAULT_MAX_STDOUT_CHARS = 16 * 1024 * 1024
export const DEFAULT_MAX_STDERR_CHARS = 64 * 1024

export function createNodeShell(limits: NodeShellLimits = {}): ShellFn {
  const maxStdout = limits.maxStdoutChars ?? DEFAULT_MAX_STDOUT_CHARS
  const maxStderr = limits.maxStderrChars ?? DEFAULT_MAX_STDERR_CHARS
  return (script, opts) =>
    new Promise((resolve, reject) => {
      const child = spawn('bash', ['-c', script], {
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      let stdout = ''
      let stderrTail = ''
      let stderrDropped = 0
      let settled = false
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')

      const killGroup = (): void => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }

      const finish = (fn: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }

      child.stdout.on('data', (chunk: string) => {
        if (settled) return
        if (stdout.length + chunk.length > maxStdout) {
          finish(() => {
            killGroup()
            reject(new Error(`shell_output_too_large: stdout passed ${maxStdout} characters; the script was killed`))
          })
          return
        }
        stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        const joined = stderrTail + chunk
        if (joined.length > maxStderr) {
          stderrDropped += joined.length - maxStderr
          stderrTail = joined.slice(joined.length - maxStderr)
        } else {
          stderrTail = joined
        }
      })

      const timer = setTimeout(() => {
        finish(() => {
          killGroup()
          reject(new Error(`shell timeout after ${opts.timeoutMs}ms`))
        })
      }, opts.timeoutMs)

      child.on('error', (err) => finish(() => reject(err)))
      child.on('close', (code, signal) =>
        finish(() => {
          let stderr = stderrTail
          if (stderrDropped > 0) {
            // Start the tail at a full line.
            const nl = stderr.indexOf('\n')
            stderr = `[stderr truncated: ${stderrDropped} earlier characters dropped]\n${nl >= 0 ? stderr.slice(nl + 1) : stderr}`
          }
          resolve({ exit_code: code ?? (signal ? 128 : 1), stdout, stderr })
        }),
      )
    })
}

export const nodeShell: ShellFn = createNodeShell()
