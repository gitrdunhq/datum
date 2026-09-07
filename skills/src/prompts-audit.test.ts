// Prompt audit, 2026-09-06 (docs/research/prompts-audit-20260906-213201.md).
// Unit 1: correctness. Each `it` pins one defect the audit found in the
// prompts or the agent definitions they pair with.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const P = (name: string): string => readFileSync(join(__dirname, 'prompts', name), 'utf8')
const A = (name: string): string => readFileSync(join(__dirname, '..', '..', 'agents', name), 'utf8')
const AGENTS_DIR = join(__dirname, '..', '..', 'agents')

describe('agent definitions never contradict the stage prompts on how to commit', () => {
  it('no agents/datum-*.md tells the model `git add .` or a hand-rolled `git commit -m`', () => {
    for (const f of readdirSync(AGENTS_DIR).filter((n) => n.startsWith('datum-') && n.endsWith('.md'))) {
      const text = A(f)
      expect(text, f).not.toMatch(/git add \./)
      expect(text, f).not.toMatch(/git commit -m/)
    }
  })
  it('the writing agents are told to commit with the exact command the prompt gives', () => {
    for (const f of ['datum-red.md', 'datum-green.md', 'datum-refactor.md']) {
      expect(A(f), f).toMatch(/exact commit command the prompt gives/i)
    }
  })
  it('datum-green.md no longer claims GREEN cannot see test source, and names no packet field the runner does not send', () => {
    const g = A('datum-green.md')
    expect(g).not.toMatch(/cannot see test source/)
    expect(g).not.toMatch(/impl_stubs|existing_api/)
    expect(P('green.md')).not.toMatch(/impl_stubs|existing_api/)
  })
})

describe('the read-only judgement calls run under an agent that can judge', () => {
  it('agents/datum-quality-reader.md exists: Read, Grep, Glob, no writes, enough turns to read a lane', () => {
    const q = A('datum-quality-reader.md')
    expect(q).toMatch(/^tools: Read, Grep, Glob/m)
    expect(q).toMatch(/^maxTurns: 12/m)
    expect(q).not.toMatch(/Write|Edit/)
  })
  it('refactor-check and docs-check route through the quality stage, not the one-file reader', () => {
    const lane = readFileSync(join(__dirname, 'datum-tdd-act-lane.ts'), 'utf8')
    const docs = readFileSync(join(__dirname, 'datum-tdd-act-docs.ts'), 'utf8')
    expect(lane).toMatch(/refactorCheckPrompt\([\s\S]{0,200}stageOpts\('quality'/)
    expect(docs).toMatch(/docsCheckPrompt\([\s\S]{0,200}stageOpts\('quality'/)
    expect(readFileSync(join(__dirname, 'shared', 'agent-types.ts'), 'utf8')).toMatch(/quality: 'datum-quality-reader'/)
  })
})

describe('reflect has one scope rule and one rubric', () => {
  it('reflect.md tells the scorer to inspect prior-lane tests for stale_owned_test while not scoring them, in one place', () => {
    const r = P('reflect.md')
    expect(r).not.toMatch(/IGNORE those tests entirely/)
    expect(r).toMatch(/stale_owned_test/)
    expect(r).toMatch(/neither count for nor against/i)
  })
  it('agents/datum-reflect.md carries no second rubric', () => {
    const d = A('datum-reflect.md')
    expect(d).not.toMatch(/\b(9|10)\s*[-–:]/)
    expect(d).toMatch(/rubric in the prompt/i)
  })
})

describe('refine-spec.md describes the structure the refine gate checks', () => {
  it('names the sections as ## headings, the guess rule, and the banned terms', () => {
    const s = P('refine-spec.md')
    expect(s).toMatch(/## Assumption Audit/)
    expect(s).toMatch(/## Requirements/)
    expect(s).toMatch(/## Classification Metadata/)
    expect(s).toMatch(/a `guess` must name an answered Q<n>/i)
    expect(s).toMatch(/etc\./)
    expect(s).toMatch(/never use in an acceptance criterion/i)
  })
})

describe('the skeptic panel: lenses are independent, the definition is thin', () => {
  it('agents/datum-skeptic.md no longer hands every lens the edge and error checklists', () => {
    const d = A('datum-skeptic.md')
    expect(d).not.toMatch(/off-by-one/i)
    expect(d).not.toMatch(/empty collection/i)
    expect(d).toMatch(/missing defensive/i)
  })
  it('skeptic-base.md states the output shape once, as the schema does, and each lens defers to it', () => {
    for (const lens of ['skeptic-edge.md', 'skeptic-error.md', 'skeptic-contract.md']) {
      expect(P(lens), lens).not.toMatch(/For each finding:/)
    }
    expect(P('skeptic-base.md')).toMatch(/description, evidence, severity/)
  })
})

describe('headroom is stated once, hedged, and allowed where it is meant to run', () => {
  it('no template but the preamble mentions headroom', () => {
    for (const f of readdirSync(join(__dirname, 'prompts')).filter((n) => n.endsWith('.md') && n !== 'agent-preamble.md')) {
      expect(P(f), f).not.toMatch(/headroom/i)
    }
  })
  it('the preamble hedges it on availability and names the local-model runtime as its home', () => {
    const pre = P('agent-preamble.md')
    expect(pre).toMatch(/headroom_compress/)
    expect(pre).toMatch(/when (they are|available)/i)
    expect(pre).not.toMatch(/agent-preamble-full/)
  })
  it('the agents that read whole files list the headroom tools', () => {
    for (const f of ['datum-green.md', 'datum-skeptic.md', 'datum-docs.md', 'datum-quality-reader.md']) {
      expect(A(f), f).toMatch(/mcp__headroom__headroom_compress/)
    }
  })
})

describe('validate-check has a schema and asks only for what is read', () => {
  it('VALIDATE_CHECK_SCHEMA exists and the call passes it', () => {
    expect(readFileSync(join(__dirname, 'shared', 'schemas.ts'), 'utf8')).toMatch(/export const VALIDATE_CHECK_SCHEMA/)
    expect(readFileSync(join(__dirname, 'datum-validate.ts'), 'utf8')).toMatch(/schema: VALIDATE_CHECK_SCHEMA/)
  })
  it('the template drops committed_fixes, commit_sha and the unused SPEC path', () => {
    const v = P('validate-check.md')
    expect(v).not.toMatch(/committed_fixes|commit_sha|specPath|PROPERTIES/)
  })
})

describe('dead prompt files are gone', () => {
  it('util-detect-branch.md and agent-preamble-full.md no longer exist, and awake no longer writes a full preamble', () => {
    expect(existsSync(join(__dirname, 'prompts', 'util-detect-branch.md'))).toBe(false)
    expect(existsSync(join(__dirname, 'prompts', 'agent-preamble-full.md'))).toBe(false)
    expect(readFileSync(join(__dirname, 'datum-awake.ts'), 'utf8')).not.toMatch(/preamble_full/)
    expect(P('awake-distill.md')).not.toMatch(/OUTPUT 2|preamble_full/)
  })
  it('closeout-synthesize.md asks for no key_metrics nothing reads', () => {
    expect(P('closeout-synthesize.md')).not.toMatch(/key_metrics/)
  })
})
