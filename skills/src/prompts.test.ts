// #524 dogfooding — plan-triage.md and plan-deepen.md told the agent to
// "Read TASKS.md in the working directory" / "Read TASKS.md" with no
// epic-scoped path. datum-plan.ts writes TASKS.md to
// docs/epics/<branch>/TASKS.md (`datum lane-plan --md-output
// "${epicDir}/TASKS.md"`), not the repo root — so a bare "TASKS.md" read
// silently resolves against whatever happens to be sitting at repo root,
// including a stale leftover TASKS.md from a completely unrelated prior
// epic. A peer session hit exactly this: the triage decision reasoned about
// a different epic's 28-task plan instead of the current one.
//
// Other prompts in this codebase already establish the pattern for this —
// util-read-context.md's extraFields reference
// docs/epics/$(git rev-parse --abbrev-ref HEAD)/SPEC.md rather than a bare
// SPEC.md — so plan-triage.md/plan-deepen.md should follow the same
// convention instead of assuming cwd is already the epic dir.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const planTriage = readFileSync(join(__dirname, 'prompts', 'plan-triage.md'), 'utf8')
const planDeepen = readFileSync(join(__dirname, 'prompts', 'plan-deepen.md'), 'utf8')

describe('plan-triage.md reads the epic-scoped TASKS.md, not a bare filename (#524)', () => {
  it('does not tell the agent to read a bare "TASKS.md"', () => {
    expect(planTriage).not.toMatch(/Read TASKS\.md in the working directory/)
  })

  it('points at docs/epics/<branch>/TASKS.md via the same git-branch pattern other prompts use', () => {
    expect(planTriage).toMatch(/docs\/epics\/\$\(git rev-parse --abbrev-ref HEAD\)\/TASKS\.md/)
  })
})

describe('plan-deepen.md reads/writes the epic-scoped TASKS.md, not a bare filename (#524)', () => {
  it('reads the epic-scoped path, not a bare "TASKS.md"', () => {
    expect(planDeepen).not.toMatch(/^Read TASKS\.md,/m)
    expect(planDeepen).toMatch(/Read docs\/epics\/\$\(git rev-parse --abbrev-ref HEAD\)\/TASKS\.md/)
  })

  it('appends to the epic-scoped path, not a bare "TASKS.md"', () => {
    expect(planDeepen).not.toMatch(/end of TASKS\.md titled/)
    expect(planDeepen).toMatch(/end of docs\/epics\/\$\(git rev-parse --abbrev-ref HEAD\)\/TASKS\.md titled/)
  })

  it('commits the epic-scoped path, not a bare "TASKS.md"', () => {
    expect(planDeepen).not.toMatch(/git add TASKS\.md/)
    expect(planDeepen).toMatch(/git add docs\/epics\/\$\(git rev-parse --abbrev-ref HEAD\)\/TASKS\.md/)
  })
})
