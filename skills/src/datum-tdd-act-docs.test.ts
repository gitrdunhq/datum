// Root-checkout docs commit policy (decided with the eedom dogfooding user,
// run wf_70b84a20-f2a): a commit step that runs in the ROOT checkout must
// stage and commit only its allowed paths and refuse only when those paths
// are wrong — unrelated modified tracked files (the operator's WIP in
// AGENTS.md/CLAUDE.md) are not violations. The strict rule stays for lane
// worktrees, where any out-of-scope change really is the agent misbehaving.
// And the outcome must be surfaced: the docs workflow set synced=true even
// when the commit refused, and both orchestrators discarded its result.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const docsSrc = readFileSync(join(__dirname, 'datum-tdd-act-docs.ts'), 'utf8')
const agentsSrc = readFileSync(join(__dirname, 'shared', 'agents.ts'), 'utf8')

describe('commitStage scope: allowed-only for root-checkout commits', () => {
  it('commitStage accepts a scope option and the allowed-only prompt does not treat unrelated files as violations', () => {
    expect(agentsSrc).toMatch(/scope\??:\s*'strict' \| 'allowed-only'/)
    const fn = agentsSrc.slice(agentsSrc.indexOf('export async function commitStage'))
    expect(fn).toMatch(/allowed-only/)
    // The allowed-only branch must instruct staging of the allowed files only
    // and explicitly ignore other modified files.
    expect(fn).toMatch(/ignore[^\n]*other modified files|other modified files[^\n]*ignore/i)
  })

  it('the docs workflow commits in allowed-only scope (it runs in the root checkout)', () => {
    expect(docsSrc).toMatch(/commitStage\([\s\S]{0,200}?scope:\s*'allowed-only'/)
  })
})

describe('docs workflow surfaces the commit outcome', () => {
  it('captures the commitStage result instead of discarding it', () => {
    expect(docsSrc).toMatch(/const \w+ = await commitStage\(/)
  })

  it('reports synced only when the commit actually landed, and exposes committed/commit_sha/failure_reason', () => {
    // `synced = true` may only be reached inside the committed branch.
    expect(docsSrc).toMatch(/if \(committed\) \{[\s\S]{0,300}?synced = true/)
    expect((docsSrc.match(/synced = true/g) || []).length).toBe(1)
    expect(docsSrc).toMatch(/__workflowResult = \{[^}]*committed/)
    expect(docsSrc).toMatch(/__workflowResult = \{[^}]*failure_reason/)
  })
})
