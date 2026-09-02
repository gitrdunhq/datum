// Tests for the datum-go boot seam.
//
// #353 — sub-workflow scriptPaths must resolve to a repo-local copy
//        (.datum/skills/<name>.js) when one exists; an out-of-repo absolute
//        skills_dir is refused by the Workflow harness, so the resolver must
//        flag it so the caller can log the fix hint.

import { describe, it, expect } from 'vitest'
import {
  LOCAL_SKILLS_DIR,
  resolveSkillPath,
  skillsDirHint,
  bootPrompt,
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

describe('bootPrompt (#353)', () => {
  it('asks for the repo-local skills listing and repo root the resolver needs', () => {
    const p = bootPrompt()
    expect(p).toContain('.datum/config.json')
    expect(p).toContain('.datum/pipeline-state.json')
    expect(p).toContain(LOCAL_SKILLS_DIR)
    expect(p).toContain('"localSkills"')
    expect(p).toContain('"repoRoot"')
  })
})
