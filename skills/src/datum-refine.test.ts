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
    const throwBlock = src.slice(src.indexOf('ticket_exists || !ticketContent'))
    expect(throwBlock).toMatch(/issueNumber/)
  })

  it('the not-found error mentions freeText when one was passed and ignored', () => {
    const throwBlock = src.slice(src.indexOf('ticket_exists || !ticketContent'))
    expect(throwBlock).toMatch(/freeText/)
  })

  it('still gives the plain "run datum init first" guidance when neither was passed', () => {
    const throwBlock = src.slice(src.indexOf('ticket_exists || !ticketContent'), src.indexOf('ticket_exists || !ticketContent') + 800)
    expect(throwBlock).toMatch(/datum init/)
  })
})
