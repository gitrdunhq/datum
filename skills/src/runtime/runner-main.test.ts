// Tests for DAT-18 — the Node entry `main(argv, io)` of the runner. It parses
// the flags, runs the bundle through runBundle and reports through the injected
// stdout/stderr writers, returning the process exit code.

import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from './runner'

const tmp = mkdtempSync(join(tmpdir(), 'dat18-main-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function fixture(bundleBody: string) {
  const dir = join(tmp, `case-${n++}`)
  mkdirSync(dir, { recursive: true })
  const bundle = join(dir, 'bundle.js')
  const args = join(dir, 'args.json')
  const config = join(dir, 'config.json')
  const repoRoot = join(dir, 'repo')
  const skillsDir = join(dir, 'skills')
  mkdirSync(repoRoot, { recursive: true })
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(bundle, `export const meta = { name: 'dat18-test' }\n${bundleBody}\n`)
  writeFileSync(args, JSON.stringify({ run_id: 'dat18' }))
  writeFileSync(
    config,
    JSON.stringify({ runtime: { kind: 'fake', models: { fast: 'f', balanced: 'b', deep: 'd' } } }),
  )
  const argv = ['--bundle', bundle, '--args', args, '--config', config, '--repo-root', repoRoot, '--skills-dir', skillsDir]
  return { argv, bundle, repoRoot, skillsDir }
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out,
    err,
    io: { stdout: (s: string) => void out.push(s), stderr: (s: string) => void err.push(s) },
  }
}

describe('runner main', () => {
  it("AC1: a bundle returning {ok:1} writes '{\"ok\":1}' to stdout and main returns exit code 0", async () => {
    const { argv } = fixture('return { ok: 1 }')
    const { out, err, io } = capture()
    const code = await main(argv, io)
    expect(code).toBe(0)
    expect(out.join('').trimEnd()).toBe('{"ok":1}')
    expect(err.join('')).toBe('')
  })

  it('AC1: the stdout JSON is the bundle result, not a fixed value', async () => {
    const { argv } = fixture("return { name: 'x', list: [1, 2] }")
    const { out, io } = capture()
    const code = await main(argv, io)
    expect(code).toBe(0)
    expect(out.join('').trimEnd()).toBe('{"name":"x","list":[1,2]}')
  })

  it("AC2: a bundle that throws Error('bad') makes main return 1 and write 'bad' to stderr", async () => {
    const { argv } = fixture("throw new Error('bad')")
    const { out, err, io } = capture()
    const code = await main(argv, io)
    expect(code).toBe(1)
    expect(err.join('')).toContain('bad')
    expect(out.join('')).toBe('')
  })

  it('AC2: a missing bundle file also returns 1 with a message on stderr', async () => {
    const { argv } = fixture('return 1')
    argv[1] = join(tmp, 'does-not-exist.js')
    const { out, err, io } = capture()
    const code = await main(argv, io)
    expect(code).toBe(1)
    expect(err.join('').length).toBeGreaterThan(0)
    expect(out.join('')).toBe('')
  })
})
