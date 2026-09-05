// Root-checkout docs commit policy (decided with the eedom dogfooding user,
// run wf_70b84a20-f2a): a commit step that runs in the ROOT checkout must
// stage and commit only its allowed paths — unrelated modified tracked files
// (the operator's WIP) are not violations. And the outcome must be surfaced.
//
// wf_b1c88e09-036 (BUG G/H): the commit was an LLM agent (datum-cli,
// maxTurns 3) told to run status → add → commit — its whole turn budget —
// so it could never return its StructuredOutput; the harness threw and the
// whole datum-go run died. It also copied attribution trailers into the
// message. The commit is now a deterministic batch (shared/commit-steps.ts)
// with the exact message, and its exit code is what the script trusts.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const docsSrc = readFileSync(join(__dirname, 'datum-tdd-act-docs.ts'), 'utf8')
const goSrc = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')
const actSrc = readFileSync(join(__dirname, 'datum-tdd-act.ts'), 'utf8')

describe('docs commit is a deterministic batch, not a commit agent', () => {
  it('uses commitFilesSteps/commitFilesFromSteps scoped to the files the docs agent wrote', () => {
    expect(docsSrc).toMatch(/from '\.\/shared\/commit-steps'/)
    expect(docsSrc).toMatch(/commitFilesSteps\(\{ wt: '\.', files: docsWritten, message: `docs\(\$\{a\.runId\}\): /)
    expect(docsSrc).toMatch(/commitFilesFromSteps\(/)
    expect(docsSrc).not.toMatch(/commitStage\(/)
    expect(docsSrc).not.toMatch(/COMMIT_RESULT_SCHEMA/)
  })

  it('the LLM commit agent is gone from the codebase (no consumer left)', () => {
    const agentsSrc = readFileSync(join(__dirname, 'shared', 'agents.ts'), 'utf8')
    expect(agentsSrc).not.toMatch(/export async function commitStage/)
    expect(existsSync(join(__dirname, 'prompts', 'commit.md'))).toBe(false)
  })

  it('treats "nothing to commit" as a rerun after a landed commit (synced, not failed), and a failed commit as failure_reason', () => {
    expect(docsSrc).toMatch(/nothingToCommit/)
    expect(docsSrc).toMatch(/if \(committed\) \{[\s\S]{0,300}?synced = true/)
    expect((docsSrc.match(/synced = true/g) || []).length).toBe(1)
    expect(docsSrc).toMatch(/__workflowResult = \{[^}]*committed/)
    expect(docsSrc).toMatch(/__workflowResult = \{[^}]*failure_reason/)
  })
})

describe('docs sub-workflow fails soft in both orchestrators', () => {
  // A docs failure must land in the Act summary, never abort the run — the
  // lanes are already merged by then and the halt record still has to be
  // written.
  for (const [name, src] of [['datum-go.ts', goSrc], ['datum-tdd-act.ts', actSrc]] as const) {
    it(`${name} wraps the docs workflow call in try/catch and continues`, () => {
      const idx = src.indexOf("sk('datum-tdd-act-docs')")
      expect(idx).toBeGreaterThan(-1)
      const before = src.slice(Math.max(0, idx - 400), idx)
      const after = src.slice(idx, idx + 900)
      expect(before).toMatch(/try \{/)
      expect(after).toMatch(/catch \((\w+)\)/)
      expect(after).toMatch(/docs_workflow_failed/)
    })
  }
})
