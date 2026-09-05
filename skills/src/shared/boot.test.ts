// Tests for the datum-go boot seam.
//
// #353 — sub-workflow scriptPaths must resolve to a repo-local copy
//        (.datum/skills/<name>.js) when one exists; an out-of-repo absolute
//        skills_dir is refused by the Workflow harness, so the resolver must
//        flag it so the caller can log the fix hint.
// #354 — the boot/config-read agent is replay-cached by (prompt, opts); the
//        prompt must carry a config fingerprint so a changed config changes
//        the cache key.
// #355 — a bare shell one-liner as an agent prompt makes the agent ask
//        "what is my task?"; every shell-out prompt must be wrapped with an
//        explicit run-this-and-return-stdout instruction.

import { describe, it, expect } from 'vitest'
import {
  LOCAL_SKILLS_DIR,
  resolveSkillPath,
  skillsDirHint,
  bootSteps,
  bootFromSteps,
  runCommandPrompt,
} from './boot'
import type { BatchResult, BatchStepResult } from './batch'

function result(steps: Partial<BatchStepResult>[]): BatchResult {
  const full = steps.map((s) => ({ name: '', exit_code: 0, stdout: '', stderr: '', ...s }))
  return { steps: full, failed: full.find((s) => s.exit_code !== 0) ?? null, missing: false }
}

describe('resolveSkillPath (#353)', () => {
  it('prefers the repo-local .datum/skills copy when it exists', () => {
    const r = resolveSkillPath({
      name: 'datum-plan',
      skillsDir: '/Volumes/elsewhere/datum/skills',
      localSkills: ['datum-go.js', 'datum-plan.js'],
      repoRoot: '/Users/me/consumer',
    })
    expect(r.path).toBe(`${LOCAL_SKILLS_DIR}/datum-plan.js`)
    expect(r.outsideRepo).toBe(false)
  })

  it('falls back to skills_dir and flags an out-of-repo absolute path', () => {
    const r = resolveSkillPath({
      name: 'datum-plan',
      skillsDir: '/Volumes/elsewhere/datum/skills',
      localSkills: [],
      repoRoot: '/Users/me/consumer',
    })
    expect(r.path).toBe('/Volumes/elsewhere/datum/skills/datum-plan.js')
    expect(r.outsideRepo).toBe(true)
  })

  it('keeps the datum repo\'s own absolute skills_dir working (inside repo root)', () => {
    const r = resolveSkillPath({
      name: 'datum-plan',
      skillsDir: '/Users/me/datum/skills',
      localSkills: [],
      repoRoot: '/Users/me/datum',
    })
    expect(r.path).toBe('/Users/me/datum/skills/datum-plan.js')
    expect(r.outsideRepo).toBe(false)
  })

  it('does not treat a sibling directory with a shared prefix as inside the repo', () => {
    const r = resolveSkillPath({
      name: 'datum-plan',
      skillsDir: '/Users/me/datum-other/skills',
      localSkills: [],
      repoRoot: '/Users/me/datum',
    })
    expect(r.outsideRepo).toBe(true)
  })

  it('treats a relative skills_dir (or none) as inside the repo', () => {
    expect(resolveSkillPath({ name: 'x', skillsDir: '', localSkills: [], repoRoot: '/r' }).path).toBe('skills/x.js')
    expect(resolveSkillPath({ name: 'x', skillsDir: '', localSkills: [], repoRoot: '/r' }).outsideRepo).toBe(false)
    expect(resolveSkillPath({ name: 'x', skillsDir: 'vendor/skills', localSkills: [], repoRoot: '' }).outsideRepo).toBe(false)
  })

  it('cannot flag outsideRepo when the repo root is unknown', () => {
    const r = resolveSkillPath({ name: 'x', skillsDir: '/abs/skills', localSkills: [], repoRoot: '' })
    expect(r.path).toBe('/abs/skills/x.js')
    expect(r.outsideRepo).toBe(false)
  })
})

describe('skillsDirHint (#353)', () => {
  it('is a single line naming both fixes', () => {
    const hint = skillsDirHint('/Volumes/elsewhere/datum/skills')
    expect(hint).not.toContain('\n')
    expect(hint).toContain('datum init --refresh-skills')
    expect(hint).toContain('/add-dir /Volumes/elsewhere/datum/skills')
  })
})

// bootSteps / bootFromSteps (#368 follow-up): deterministic replacement for
// the old bootPrompt LLM relay — one datum-cli batch cats both config files,
// pipeline state, lists .datum/skills, and reports repo root + branch; every
// one of those facts was previously trusted verbatim from an LLM's JSON echo.

describe('bootSteps', () => {
  const steps = bootSteps()
  const names = steps.map((s) => s.name)

  it('has the six expected step names in order', () => {
    expect(names).toEqual(['global-config', 'repo-config', 'state', 'local-skills', 'repo-root', 'branch'])
  })

  it('marks every step tolerant except repo-config (its absence is fatal)', () => {
    for (const s of steps) {
      if (s.name === 'repo-config') expect(s.tolerant).toBeFalsy()
      else expect(s.tolerant).toBe(true)
    }
  })

  it('repo-config reads .datum/config.json with no fallback', () => {
    const s = steps.find((s) => s.name === 'repo-config')!
    expect(s.command).toContain('.datum/config.json')
    expect(s.command).not.toMatch(/\|\|/)
  })

  it('local-skills lists LOCAL_SKILLS_DIR', () => {
    const s = steps.find((s) => s.name === 'local-skills')!
    expect(s.command).toContain(LOCAL_SKILLS_DIR)
  })
})

describe('bootFromSteps', () => {
  const ok = (overrides: Partial<Record<string, string>> = {}) =>
    result([
      { name: 'global-config', exit_code: 0, stdout: overrides['global-config'] ?? '{}' },
      { name: 'repo-config', exit_code: 0, stdout: overrides['repo-config'] ?? '{"language":"python"}' },
      { name: 'state', exit_code: 0, stdout: overrides['state'] ?? 'null' },
      { name: 'local-skills', exit_code: 0, stdout: overrides['local-skills'] ?? 'datum-go\ndatum-plan' },
      { name: 'repo-root', exit_code: 0, stdout: overrides['repo-root'] ?? '/Users/me/repo' },
      { name: 'branch', exit_code: 0, stdout: overrides['branch'] ?? 'main' },
    ])

  it('merges global/repo config via mergeConfig (repo wins)', () => {
    const boot = bootFromSteps(
      ok({ 'global-config': '{"language":"python","test_command":"pytest"}', 'repo-config': '{"test_command":"go test ./..."}' }),
    )
    expect(boot.config.language).toBe('python')
    expect(boot.config.test_command).toBe('go test ./...')
  })

  it('throws when the repo-config step is missing/failed', () => {
    const r = ok()
    r.steps = r.steps.filter((s) => s.name !== 'repo-config')
    expect(() => bootFromSteps(r)).toThrow(/missing \.datum\/config\.json — run datum init first/)
  })

  it('throws when repo-config stdout is not valid JSON', () => {
    expect(() => bootFromSteps(ok({ 'repo-config': 'not json' }))).toThrow(/missing \.datum\/config\.json/)
  })

  it('falls back to {} when global-config is missing/unparseable', () => {
    const boot = bootFromSteps(ok({ 'global-config': 'not json' }))
    expect(boot.config.language).toBe('python')
  })

  it('parses null state as no prior state', () => {
    expect(bootFromSteps(ok({ state: 'null' })).state).toBeNull()
  })

  it('parses a real pipeline-state.json', () => {
    const boot = bootFromSteps(ok({ state: '{"branch":"main","runId":"r1","completedPhases":["refine"]}' }))
    expect(boot.state).toEqual({ branch: 'main', runId: 'r1', completedPhases: ['refine'] })
  })

  // Mirrors datum/pipeline_state.py's PipelineStateCorruptError: a corrupt
  // pipeline-state.json must never be silently treated the same as "no
  // state" — that would discard tracked pipeline progress on file corruption.
  it('throws pipeline_state_corrupt on unparseable non-null state, never treating it as null', () => {
    expect(() => bootFromSteps(ok({ state: '{not valid json' }))).toThrow(/pipeline_state_corrupt/)
  })

  it('parses local-skills basenames back into "<name>.js" filenames', () => {
    expect(bootFromSteps(ok({ 'local-skills': 'datum-go\ndatum-plan' })).localSkills).toEqual([
      'datum-go.js',
      'datum-plan.js',
    ])
  })

  it('returns [] for localSkills when the step stdout is empty', () => {
    expect(bootFromSteps(ok({ 'local-skills': '' })).localSkills).toEqual([])
  })

  it('trims repoRoot/currentBranch', () => {
    const boot = bootFromSteps(ok({ 'repo-root': '/Users/me/repo\n', branch: 'main\n' }))
    expect(boot.repoRoot).toBe('/Users/me/repo')
    expect(boot.currentBranch).toBe('main')
  })

  it('throws when repoRoot is empty (not a git repo)', () => {
    expect(() => bootFromSteps(ok({ 'repo-root': '' }))).toThrow(/repo root/)
  })

  it('throws when currentBranch is empty (detached HEAD)', () => {
    expect(() => bootFromSteps(ok({ branch: '' }))).toThrow(/current branch/)
  })
})

describe('runCommandPrompt (#355)', () => {
  it('wraps a bare command with an explicit run-and-return-stdout instruction', () => {
    const cmd = 'REPO_ROOT=$(git rev-parse --show-toplevel) && echo "$REPO_ROOT"'
    const p = runCommandPrompt(cmd)
    expect(p).toContain('Run exactly this command with the Bash tool')
    expect(p).toContain('return only its stdout')
    expect(p).toContain(cmd)
    expect(p).toMatch(/do not ask/i)
  })

  it('never returns the bare command unchanged', () => {
    expect(runCommandPrompt('ls')).not.toBe('ls')
    expect(runCommandPrompt('ls').startsWith('ls')).toBe(false)
  })
})
