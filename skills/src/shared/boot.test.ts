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
  bootPrompt,
  runCommandPrompt,
} from './boot'

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

describe('bootPrompt (#353, #354)', () => {
  it('embeds the config fingerprint so a config change changes the cache key', () => {
    const a = bootPrompt('sha256:aaaa')
    const b = bootPrompt('sha256:bbbb')
    expect(a).toContain('sha256:aaaa')
    expect(a).not.toBe(b)
  })

  it('is stable for the same fingerprint (resume still cache-hits on unchanged config)', () => {
    expect(bootPrompt('sha256:aaaa')).toBe(bootPrompt('sha256:aaaa'))
  })

  it('still produces a usable prompt without a fingerprint', () => {
    const p = bootPrompt('')
    expect(p).toContain('.datum/config.json')
    expect(p).toContain('.datum/pipeline-state.json')
  })

  it('asks for the repo-local skills listing and repo root the resolver needs', () => {
    const p = bootPrompt('sha256:aaaa')
    expect(p).toContain('.datum/config.json')
    expect(p).toContain('.datum/pipeline-state.json')
    expect(p).toContain(LOCAL_SKILLS_DIR)
    expect(p).toContain('"localSkills"')
    expect(p).toContain('"repoRoot"')
  })
})

describe('bootPrompt (#355)', () => {
  it('gives an explicit task instead of a bare command', () => {
    const p = bootPrompt('sha256:aaaa')
    expect(p).toMatch(/Bash tool/)
    expect(p).toMatch(/raw JSON only/i)
    expect(p).toMatch(/do not ask/i)
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
