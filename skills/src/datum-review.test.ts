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

// ---------------------------------------------------------------------------
// Determinism fix (#368 follow-up) — util-read-context.md and
// util-commit-artifact.md were imported but never referenced anywhere in
// this file: every domain agent reads its own context (SPEC.md, diffs, etc.)
// directly via its own prompt/tool calls, and the report commit is its own
// inline agent() call. Both imports are dead weight, removed alongside the
// retirement of the util-read-context.md LLM relay.
// ---------------------------------------------------------------------------

// The report's content is rendered by the script (reportLines), yet it was
// handed to an LLM runner: "Write this content to docs/epics/$(git ...)/
// REVIEW-REPORT.md ... Commit: ...". A runner that re-wrapped a table row
// or dropped the bold severity broke `datum gate review`'s detection, and
// its reply was discarded. Now: a byte-verified batch write, a batch
// commit, both halting by name.
describe('datum-review — the report is written and committed by batches, not an LLM runner', () => {
  it('resolves the branch from a batch step first (the script needs the epic dir itself now)', () => {
    expect(datumReviewSrc).toMatch(/git rev-parse --abbrev-ref HEAD/)
    expect(datumReviewSrc).toMatch(/label: 'read-branch'/)
    expect(datumReviewSrc).toMatch(/const epicDir = `docs\/epics\/\$\{branch\}`/)
  })

  it('writes REVIEW-REPORT.md through writeFileSteps and verifies the blob sha', () => {
    expect(datumReviewSrc).not.toMatch(/Write this content to/)
    expect(datumReviewSrc).toMatch(/writeFileSteps\(\{ path: reportPath, content: reportContent \}\)/)
    expect(datumReviewSrc).toMatch(/writeFileFromSteps\(parseBatchResult\(/)
    expect(datumReviewSrc).toMatch(/writeFileBlobSha\(reportContent\)/)
    expect(datumReviewSrc).toMatch(/if \(!written\.ok\) throw new Error\(written\.error\)/)
  })

  it('commits the report through commitFilesSteps under the commit-report label and halts on review_commit_failed', () => {
    expect(datumReviewSrc).not.toMatch(/&& git commit -m/)
    expect(datumReviewSrc).toMatch(/commitFilesSteps\(\{ wt: '\.', files: \[reportPath\], message: `review: REVIEW-REPORT\.md \(\$\{deduped\.length\} findings\)` \}\)/)
    expect(datumReviewSrc).toMatch(/throw new Error\(`review_commit_failed: /)
  })
})

describe('determinism fix — dead util-read-context.md / util-commit-artifact.md imports removed', () => {
  it('no longer imports the unused util-read-context.md template', () => {
    expect(datumReviewSrc).not.toMatch(/from '\.\/prompts\/util-read-context\.md'/)
  })

  it('no longer imports the unused util-commit-artifact.md template', () => {
    expect(datumReviewSrc).not.toMatch(/from '\.\/prompts\/util-commit-artifact\.md'/)
  })
})

// ---------------------------------------------------------------------------
// FLOW.md design principle 2 — a null/unparseable domain-reviewer result used
// to silently become `findings: []`, letting a crashed or garbled reviewer
// look indistinguishable from one that genuinely found nothing, and letting
// `datum gate review` pass on a falsely-clean REVIEW-REPORT.md.
// ---------------------------------------------------------------------------

describe('datum-review — domain findings use the strict parser and reject a null result', () => {
  it('imports parseAgentJsonStrict', () => {
    expect(datumReviewSrc).toMatch(/import \{[^}]*parseAgentJsonStrict[^}]*\} from '\.\/shared\/utils'/)
  })

  it('a null domain result throws a named agent_output_unparseable error instead of "(null)" + continue', () => {
    const loopIdx = datumReviewSrc.indexOf('for (let i = 0; i < DOMAINS.length; i++)')
    const block = datumReviewSrc.slice(loopIdx, loopIdx + 600)
    expect(block).toMatch(/if \(!result\) \{/)
    expect(block).toMatch(/agent_output_unparseable/)
    expect(block).not.toMatch(/\(null\)`\); continue/)
  })

  it('string results are parsed with parseAgentJsonStrict labelled per domain', () => {
    expect(datumReviewSrc).toMatch(/parseAgentJsonStrict<DomainResult>\(result as string, `review-\$\{DOMAINS\[i\]\.domain\.toLowerCase\(\)\}`\)/)
  })
})

// Phase review wf_9a69f891-462: the critical/high gate compared the LLM's
// severity string verbatim, so "High"/"HIGH"/"blocker" never counted and
// canMerge could pass with high findings; and a parseable reply without a
// findings array threw a bare TypeError instead of a named error.
describe('datum-review — severity is normalised before the merge gate; a malformed domain reply fails by name', () => {
  const src = readFileSync(join(__dirname, 'datum-review.ts'), 'utf8')
  it('normalises severity to the enum (unknown values count as high, fail closed) before filtering', () => {
    expect(src).toMatch(/function normaliseSeverity\(/)
    expect(src).toMatch(/const critical = deduped\.filter\(\(f\) => f\.severity === 'critical' \|\| f\.severity === 'high'\)/)
    expect(src).toMatch(/severity: normaliseSeverity\(raw\.severity/)
    expect(src).toMatch(/review_severity_unknown/)
  })
  it('a domain reply without a findings array is agent_output_unparseable, not a TypeError', () => {
    expect(src).toMatch(/if \(!Array\.isArray\(parsed\.findings\)\) \{?\s*throw new Error\(`agent_output_unparseable: review-/)
  })
})
