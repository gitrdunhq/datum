// Tests for the Correctness domain reviewer in datum-review.ts using the
// spec-verify skill's per-criterion, evidence-first adjudication method
// instead of the generic freeform review-domain.md prompt the other three
// domains (Security/Performance/Architecture) still use.
//
// Why: the generic prompt asks an LLM to "find issues" in one pass, which
// tends toward a confident overall impression rather than checking each
// SPEC.md requirement individually. spec-verify's method — read SPEC.md,
// walk requirements one at a time, name evidence before the verdict,
// PASS/FAIL/UNVERIFIABLE — is a stronger fit for "does implementation match
// SPEC and ACs?" than the generic bug-hunt prompt.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const datumReviewSrc = readFileSync(join(__dirname, 'datum-review.ts'), 'utf8')
const correctnessPromptSrc = readFileSync(
  join(__dirname, 'prompts', 'review-correctness-spec-verify.md'),
  'utf8',
)

describe('datum-review — Correctness domain uses spec-verify methodology', () => {
  it('imports a dedicated correctness prompt template, distinct from the generic review-domain template', () => {
    expect(datumReviewSrc).toMatch(
      /import\s+\w+\s+from\s+['"]\.\/prompts\/review-correctness-spec-verify\.md['"]/,
    )
  })

  it('the Correctness domain agent call renders the dedicated template, not the generic one', () => {
    // The DOMAINS.map(...) agent() call must branch: Correctness gets the
    // spec-verify template, the other three domains keep reviewDomainTemplate.
    expect(datumReviewSrc).toMatch(/d\.domain\s*===\s*['"]Correctness['"]/)
  })

  it('the dedicated prompt requires reading SPEC.md before adjudicating', () => {
    expect(correctnessPromptSrc).toMatch(/SPEC\.md/)
  })

  it('the dedicated prompt requires one-criterion-at-a-time adjudication with named evidence before verdict', () => {
    expect(correctnessPromptSrc.toLowerCase()).toMatch(/evidence/)
    expect(correctnessPromptSrc).toMatch(/one\s+(criterion|requirement)\s+at\s+a\s+time/i)
  })

  it('the dedicated prompt uses PASS/FAIL/UNVERIFIABLE verdicts', () => {
    expect(correctnessPromptSrc).toMatch(/PASS/)
    expect(correctnessPromptSrc).toMatch(/FAIL/)
    expect(correctnessPromptSrc).toMatch(/UNVERIFIABLE/)
  })

  it('the dedicated prompt still returns the same Finding[] JSON contract the pipeline expects', () => {
    expect(correctnessPromptSrc).toMatch(/"domain"/)
    expect(correctnessPromptSrc).toMatch(/"findings"/)
    expect(correctnessPromptSrc).toMatch(/"severity"/)
  })
})
