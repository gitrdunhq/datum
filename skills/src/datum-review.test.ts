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

// ---------------------------------------------------------------------------
// #368 producer/consumer fix — `datum gate review` (datum/gate.py) is never
// invoked by the pipeline, and it could not pass if it were: it read
// REVIEW-REPORT.md from the repo root while this workflow writes it to
// docs/epics/<branch>/REVIEW-REPORT.md, and it required review-packets/
// unified.json, an artifact nothing produces. datum-review.ts now runs the
// gate deterministically (shared/gate.ts) after committing the report, the
// same pattern Refine/Plan/Properties/Validate already use, and exposes the
// verdict in __workflowResult so datum-go.ts can halt on it.
// ---------------------------------------------------------------------------

describe('datum-review — deterministic gate verdict (#368)', () => {
  it('runs the gate through gateSteps/parseGateResult, not an LLM echo', () => {
    expect(datumReviewSrc).toMatch(/import\s*\{\s*gateSteps,\s*parseGateResult\s*\}\s*from\s*'\.\/shared\/gate'/)
    expect(datumReviewSrc).toMatch(/gateSteps\('review', yolo \? ' --approve' : ''\)/)
    expect(datumReviewSrc).toMatch(/parseGateResult\(/)
  })

  it('runs the gate after the report commit step, not before', () => {
    const commitIdx = datumReviewSrc.indexOf("label: 'commit-report'")
    const gateIdx = datumReviewSrc.indexOf("gateSteps('review'")
    expect(commitIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(commitIdx)
  })

  it('exposes gatePassed/gateMessage/gateNeedsHuman in __workflowResult alongside canMerge/criticalFindings', () => {
    const resultIdx = datumReviewSrc.indexOf('export const __workflowResult')
    const resultBlock = datumReviewSrc.slice(resultIdx)
    expect(resultBlock).toMatch(/canMerge:\s*critical\.length === 0/)
    expect(resultBlock).toMatch(/criticalFindings:\s*critical\.length/)
    expect(resultBlock).toMatch(/gatePassed:\s*gate\.passed/)
    expect(resultBlock).toMatch(/gateMessage:\s*gate\.message/)
    expect(resultBlock).toMatch(/gateNeedsHuman:\s*gate\.needsHuman/)
  })

  it('renders each finding severity bolded (**severity**), matching gate_review\'s "**high**"/"**critical**" detection', () => {
    expect(datumReviewSrc).toMatch(/\*\*\$\{f\.severity\}\*\*/)
  })

  it('the severity a report renders agrees with the same high/critical bar used for canMerge', () => {
    // `critical` (used for canMerge) already treats 'critical' and 'high' as
    // the same threshold; the report must render exactly those findings the
    // same way the gate is documented to detect.
    const criticalIdx = datumReviewSrc.indexOf("f.severity === 'critical' || f.severity === 'high'")
    expect(criticalIdx).toBeGreaterThan(-1)
  })
})
