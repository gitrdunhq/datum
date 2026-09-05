// #524 dogfooding — a peer session ran `Workflow({ name: "datum-go", args: "521" })`
// expecting the bare issue-number shorthand to bootstrap TICKET.md from GitHub
// issue #521. It doesn't: `issueNumber` had zero consumers anywhere in the
// codebase, and the only "bootstrap a new epic" mechanism in datum-go.ts
// (the freeText new-epic-check) only fires when a PRIOR epic is already in
// progress on the branch — there is no cold-start bootstrap from a bare
// issueNumber or freeText when nothing exists yet. Refine threw a generic
// "TICKET.md not found. Run `datum init` first." with no trace that
// issueNumber/freeText were even received, several minutes into a run.
//
// This does not implement the missing auto-bootstrap (a real feature,
// tracked separately) — it makes the existing failure immediately
// diagnosable: the caller's issueNumber/freeText must be visible in the
// error so they know their input was silently ignored, not swallowed.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-refine.ts'), 'utf8')

describe('TICKET.md-not-found error is actionable about ignored issueNumber/freeText (#524)', () => {
  it('reads issueNumber and freeText out of args', () => {
    expect(src).toMatch(/a\.issueNumber/)
    expect(src).toMatch(/a\.freeText/)
  })

  it('the not-found error mentions issueNumber when one was passed and ignored', () => {
    const throwBlock = src.slice(src.indexOf('if (!ticketContent)'))
    expect(throwBlock).toMatch(/issueNumber/)
  })

  it('the not-found error mentions freeText when one was passed and ignored', () => {
    const throwBlock = src.slice(src.indexOf('if (!ticketContent)'))
    expect(throwBlock).toMatch(/freeText/)
  })

  it('still gives the plain "run datum init first" guidance when neither was passed', () => {
    const throwBlock = src.slice(src.indexOf('if (!ticketContent)'), src.indexOf('if (!ticketContent)') + 800)
    expect(throwBlock).toMatch(/datum init/)
  })
})

// ---------------------------------------------------------------------------
// Determinism fix: the Read phase used to hand an LLM `reader` agent
// util-read-context.md and trust its echoed JSON verbatim for TICKET.md's
// full contents — an LLM echoing a file is lossy (a 90 KB relay came back as
// 6.7 KB of "successful" abridged content in dogfooding), and nothing
// verified it. Mirrors the fix already applied to datum-plan.ts's
// context_files relay (commit a7093d2): one batched cat + wc -c per file,
// verified with Buffer.byteLength before the file's content is trusted.
// ---------------------------------------------------------------------------

describe('datum-refine — TICKET.md relay is a byte-verified batch, not an LLM echo', () => {
  it('no longer imports the util-read-context.md LLM relay prompt', () => {
    expect(src).not.toMatch(/from '\.\/prompts\/util-read-context\.md'/)
  })

  it('reads TICKET.md and derives branch/epic-dir via readContextSteps/contextFromSteps', () => {
    expect(src).toMatch(/readContextSteps\(/)
    expect(src).toMatch(/contextFromSteps\(/)
  })

  it('fails loud with context_relay_mismatch, not a silent fallback, when the batch agent returns nothing parseable', () => {
    expect(src).toMatch(/context_relay_mismatch/)
  })

  it('runs the read batch through the deterministic cli stage, not a JSON-echoing agent call', () => {
    expect(src).toMatch(/batchCommandPrompt\(readSteps\)/)
    expect(src).toMatch(/parseBatchResult\(/)
  })
})

// ---------------------------------------------------------------------------
// The phase gate verdict must come from the CLI's exit code via a
// deterministic batch step (shared/gate.ts), never from an LLM agent that
// ran `datum gate` and echoed the JSON back.
// ---------------------------------------------------------------------------

describe('datum-refine — deterministic gate verdict', () => {
  const src = readFileSync(join(__dirname, 'datum-refine.ts'), 'utf8')
  it('runs the gate through gateSteps/parseGateResult, not the util-run-gate LLM relay', () => {
    expect(src).not.toMatch(/util-run-gate/)
    expect(src).toMatch(/gateSteps\(/)
    expect(src).toMatch(/parseGateResult\(/)
  })
})
