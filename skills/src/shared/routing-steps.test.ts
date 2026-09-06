// tested-by contract for shared/routing-steps.ts — caliper eedom
// wf_4f739141-c8c: a consumer repo that committed .datum/routing.json under an
// earlier datum version is left with a dirty tree after every plan run,
// because plan rewrites the file and no longer commits it. After the triage
// gate has read it, a TRACKED routing.json is restored to its committed
// content and the condition is named; an untracked one is left alone.
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { batchScript, parseBatchResult, stepStdout } from './batch'
import { routingRestoreSteps, routingRestoreFromSteps } from './routing-steps'

function hermeticGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'datum-routing-'))
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: dir }
  execFileSync('git', ['init', '-q', dir], { env })
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@t'], { env })
  execFileSync('git', ['-C', dir, 'config', 'user.name', 't'], { env })
  execFileSync('git', ['-C', dir, 'config', 'core.hooksPath', '/dev/null'], { env })
  return dir
}

function runIn(dir: string, script: string): string {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', HOME: dir }
  return execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env })
}

describe('routingRestoreSteps — a tracked .datum/routing.json is restored after the triage gate', () => {
  it('builds one step that only acts when the file is tracked', () => {
    const steps = routingRestoreSteps()
    expect(steps).toHaveLength(1)
    expect(steps[0].name).toBe('routing-restore')
    expect(steps[0].command).toContain('git ls-files --error-unmatch .datum/routing.json')
    expect(steps[0].command).toContain('git checkout -- .datum/routing.json')
    expect(steps[0].tolerant).toBeUndefined()
  })

  it('under real bash: a tracked file is restored to its committed content and named routing_json_tracked', () => {
    const dir = hermeticGitRepo()
    try {
      mkdirSync(join(dir, '.datum'))
      writeFileSync(join(dir, '.datum/routing.json'), '{"decision":"old"}\n')
      runIn(dir, 'git add .datum/routing.json && git commit -q -m x')
      writeFileSync(join(dir, '.datum/routing.json'), '{"decision":"new"}\n')
      const steps = routingRestoreSteps()
      const r = parseBatchResult(runIn(dir, batchScript(steps)), steps)
      expect(r.failed).toBeNull()
      const outcome = routingRestoreFromSteps(r)
      expect(outcome).toEqual({ tracked: true, note: 'routing_json_tracked' })
      expect(readFileSync(join(dir, '.datum/routing.json'), 'utf8')).toBe('{"decision":"old"}\n')
      expect(runIn(dir, 'git status --porcelain')).toBe('')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('under real bash: an untracked file is left exactly as written', () => {
    const dir = hermeticGitRepo()
    try {
      runIn(dir, 'git commit -q --allow-empty -m x')
      mkdirSync(join(dir, '.datum'))
      writeFileSync(join(dir, '.datum/routing.json'), '{"decision":"new"}\n')
      const steps = routingRestoreSteps()
      const r = parseBatchResult(runIn(dir, batchScript(steps)), steps)
      expect(r.failed).toBeNull()
      expect(routingRestoreFromSteps(r)).toEqual({ tracked: false, note: 'routing_json_untracked' })
      expect(readFileSync(join(dir, '.datum/routing.json'), 'utf8')).toBe('{"decision":"new"}\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a step that did not run is a named absence, never "untracked"', () => {
    const steps = routingRestoreSteps()
    const r = parseBatchResult('', steps)
    expect(stepStdout(r, 'routing-restore')).toBeNull()
    expect(routingRestoreFromSteps(r)).toEqual({ tracked: null, note: 'routing_restore_unchecked' })
  })
})
