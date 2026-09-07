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
import { findingKey } from './shared/review-keys'
import { reviewBranchMoved } from './shared/review-branch'

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
    // The FINAL gate (the early structural gate runs before the lenses).
    const gateIdx = datumReviewSrc.lastIndexOf("gateSteps('review'")
    expect(commitIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBeGreaterThan(commitIdx)
  })

  it('exposes gatePassed/gateMessage/gateNeedsHuman in __workflowResult alongside canMerge/criticalFindings', () => {
    const resultIdx = datumReviewSrc.indexOf('export const __workflowResult')
    const resultBlock = datumReviewSrc.slice(resultIdx)
    // On the skip path (report already passing) canMerge follows the gate.
    expect(resultBlock).toMatch(/canMerge: outcome \? outcome\.critical\.length === 0 : gate\.passed \|\| gate\.needsHuman/)
    expect(resultBlock).toMatch(/criticalFindings: outcome \? outcome\.critical\.length : 0/)
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
    expect(datumReviewSrc).toMatch(/writeFileFromSteps\(await runBatch\(/)
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

// elonchesd review iteration 2: finding ids are renumbered every iteration,
// so an accept recorded against PERF-001 later matched a different row.
// Every report row carries a content key (lens + file + normalised
// description) that survives renumbering and line drift, and every gate
// batch goes through runBatch so a classifier refusal is retried and named.
describe('stable finding keys and the gate runner', () => {
  it('findingKey is 8 hex chars of lens+file+normalised description, insensitive to id, line, case and punctuation', () => {
    const a = findingKey('Performance', 'src/turn.ts', 'isStalemate: Array.find per frame!')
    const b = findingKey('Performance', 'src/turn.ts', '  isstalemate array find per   frame ')
    const c = findingKey('Performance', 'src/fog.ts', 'isStalemate: Array.find per frame!')
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(findingKey('Correctness', 'src/turn.ts', 'isStalemate: Array.find per frame!')).not.toBe(a)
  })

  it('the report table ends with a Key column filled from findingKey', () => {
    const src = readFileSync(join(__dirname, 'datum-review.ts'), 'utf8')
    expect(src).toContain("'| ID | Severity | File | Line | Description | Suggestion | Key |'")
    expect(src).toContain("'|---|---|---|---|---|---|---|'")
    expect(src).toMatch(/\| \$\{f\.suggestion\} \| \$\{f\.key\} \|/)
    expect(src).toMatch(/key: findingKey\(DOMAINS\[i\]\.domain, /)
  })

  for (const f of ['datum-refine.ts', 'datum-plan.ts', 'datum-properties.ts', 'datum-validate.ts', 'datum-review.ts']) {
    it(`${f} runs every gate batch through runBatch`, () => {
      const src = readFileSync(join(__dirname, f), 'utf8')
      expect(src).not.toMatch(/agent\(batchCommandPrompt\(\w*[gG]ate\w*\)/)
      expect(src).toMatch(/parseGateResult\(await runBatch\(/)
    })
  }
})

// elonchesd wf_22ad6b36-dec: the correctness lens answered in markdown, the
// strict parse threw, and Review halted with no retry. Lens calls carry a
// schema: StructuredOutput validates at the tool layer and the model
// retries on mismatch, so the prose-to-JSON failure class disappears. The
// same run showed a chained epic diffed from `merge-base HEAD main`, which
// re-reviewed all of its parent epic: the diff base is the recorded parent.
describe('review lenses are schema-validated and diff from the epic base', () => {
  const src = readFileSync(join(__dirname, 'datum-review.ts'), 'utf8')
  it('every lens agent call passes REVIEW_LENS_SCHEMA', () => {
    expect(src).toMatch(/import \{[^}]*REVIEW_LENS_SCHEMA[^}]*\} from '\.\/shared\/schemas'/)
    // The opts literal gained stageOpts('review', ...) and the worktree pin
    // (#375); the schema is still on the same single lens dispatch.
    expect(src).toMatch(/\{ label: `review-\$\{d\.domain\.toLowerCase\(\)\}`, phase: 'Review', model: d\.model, schema: REVIEW_LENS_SCHEMA,/)
  })
  it('reads the epic base from `datum epic-base` before the lenses run and hands it to both prompts', () => {
    const baseIdx = src.indexOf("{ name: 'base-branch', command: 'datum epic-base', tolerant: true }")
    const lensIdx = src.indexOf('DOMAINS.map((d) => () =>')
    expect(baseIdx).toBeGreaterThan(-1)
    expect(baseIdx).toBeLessThan(lensIdx)
    expect(src).toMatch(/renderPrompt\(reviewCorrectnessSpecVerifyTemplate, \{ baseBranch \}\)/)
    expect(src).toMatch(/renderPrompt\(reviewDomainTemplate, \{ domain: d\.domain, domainPrefix: d\.prefix, domainFocus: d\.focus, baseBranch \}\)/)
    expect(src).toMatch(/review_base_unresolved/)
  })
  it('neither prompt hard-codes main as the diff base', () => {
    for (const f of ['review-domain.md', 'review-correctness-spec-verify.md']) {
      const p = readFileSync(join(__dirname, 'prompts', f), 'utf8')
      expect(p, f).toContain('{{baseBranch}}')
      expect(p, f).not.toMatch(/merge-base HEAD main\b/)
      expect(p, f).not.toMatch(/diff main\.\.\./)
    }
  })
})

// elonchesd wf_54212856-1cb: every blocking finding of iteration 2 had been
// accepted by key; the gate answered needs_human. The yolo relaunch re-ran
// all four lenses instead of approving, wrote a third report with six new
// highs (none a defect: architecture the SPEC mandates, re-raises of
// accepted places), and hard-stopped at the iteration cap. Accepting was
// punished. Review now runs a structural early gate first and never
// regenerates a report that already passes; the lens rubric requires a
// SPEC/AC citation or a measurable NFR for high and forbids re-raising a
// place the operator has decided.
describe('datum-review — an already-passing report is not regenerated; the rubric is spec-anchored', () => {
  const src = readFileSync(join(__dirname, 'datum-review.ts'), 'utf8')
  it('runs `datum gate review --approve` before the lenses and skips them when it passes', () => {
    const early = src.indexOf("gateSteps('review', ' --approve')")
    const lenses = src.indexOf('DOMAINS.map((d) => () =>')
    expect(early).toBeGreaterThan(-1)
    expect(early).toBeLessThan(lenses)
    expect(src).toMatch(/review_already_complete/)
    expect(src).toMatch(/async function reviewFromDiff\(/)
    expect(src).toMatch(/alreadyComplete \? null : await reviewFromDiff\(\)/)
    // The final gate still applies the human-hold policy on the skip path.
    expect(src.lastIndexOf("gateSteps('review', yolo ? ' --approve' : '')")).toBeGreaterThan(src.indexOf('await reviewFromDiff()'))
  })
  it('the lens prompt requires a SPEC/AC citation or measurable NFR for high, reads REVIEW-RESPONSE.md, and does not grade against rules outside SPEC.md', () => {
    const p = readFileSync(join(__dirname, 'prompts', 'review-domain.md'), 'utf8')
    expect(p).toMatch(/REVIEW-RESPONSE\.md/)
    expect(p).toMatch(/do not re-raise/i)
    expect(p).toMatch(/cite[^\n]*(SPEC\.md|acceptance criterion|requirement id)/i)
    expect(p).toMatch(/outside SPEC\.md/i)
  })
})

// ---------------------------------------------------------------------------
// #375 — the review lenses were dispatched with no read-only protection and no
// worktree pinning. In a real run the Architecture lens ran `git checkout
// <other branch>` in the operator's main checkout: the diff, the synthesis and
// the committed REVIEW-REPORT.md were for the wrong branch, and the operator's
// checkout was left on another branch with a stray commit. Three layers now:
// the read-only agentType (agents/datum-reviewer.md + its PreToolUse hooks),
// worktree pinning on every lens dispatch, and a deterministic branch-drift
// check that halts as review_branch_moved.
// ---------------------------------------------------------------------------

describe('datum-review — the lenses are read-only, pinned and branch-checked (#375)', () => {
  const src = readFileSync(join(__dirname, 'datum-review.ts'), 'utf8')

  it('dispatches every lens through the read-only review stage, not the runtime default', () => {
    expect(src).toMatch(/stageOpts\('review',/)
    const lensIdx = src.indexOf('DOMAINS.map((d) => () =>')
    const block = src.slice(lensIdx, lensIdx + 800)
    expect(block).toMatch(/stageOpts\('review',\s*\{ label: `review-\$\{d\.domain\.toLowerCase\(\)\}`/)
    // the old comment claiming no datum-* definition fits the lenses is gone
    expect(src).not.toMatch(/no datum-\* definition fits them/)
  })

  it("pins every lens to the review checkout with worktree, the #349 shape", () => {
    expect(src).toMatch(/lensWorktree/)
    const lensIdx = src.indexOf('DOMAINS.map((d) => () =>')
    expect(src.slice(lensIdx, lensIdx + 800)).toMatch(/\.\.\.lensWorktree/)
    expect(src).toMatch(/worktree: a\.repoRoot/)
  })

  it('reads the branch before the lenses and halts as review_branch_moved if it moved', () => {
    const beforeIdx = src.indexOf("name: 'branch-before'")
    const lensIdx = src.indexOf('DOMAINS.map((d) => () =>')
    expect(beforeIdx).toBeGreaterThan(-1)
    expect(beforeIdx).toBeLessThan(lensIdx)
    expect(src).toMatch(/import \{ reviewBranchMoved \} from '\.\/shared\/review-branch'/)
    expect(src).toMatch(/reviewBranchMoved\(branchBefore, branch\)/)
    // the halt happens before the report is written to the wrong epic dir
    const movedIdx = src.indexOf('reviewBranchMoved(branchBefore, branch)')
    expect(movedIdx).toBeLessThan(src.indexOf('const writeSteps ='))
    expect(src).toMatch(/review_branch_unchecked/)
  })
})

describe('reviewBranchMoved (#375)', () => {
  it('names the drift with both branches when the checkout moved', () => {
    const msg = reviewBranchMoved('epic/a', 'main')
    expect(msg).toMatch(/^review_branch_moved: /)
    expect(msg).toContain('main')
    expect(msg).toContain('epic/a')
  })

  it('is null when the branch is unchanged, ignoring surrounding whitespace', () => {
    expect(reviewBranchMoved('epic/a', 'epic/a')).toBeNull()
    expect(reviewBranchMoved(' epic/a\n', 'epic/a')).toBeNull()
  })

  it('is null (unchecked, not a false halt) when either read produced nothing', () => {
    expect(reviewBranchMoved('', 'main')).toBeNull()
    expect(reviewBranchMoved('main', '')).toBeNull()
  })
})

// #341 wf_ae694af5-a70: on a 115-file, 8000-line epic diff three of four
// lenses ran out of turns without ever calling StructuredOutput, the lens
// policy allowed no retry, and Review halted agent_output_unparseable. A
// lens has a stated tool-call budget and returns what it has before the cap;
// a lens that still returns nothing is retried once.
describe('review lenses budget their reads and get one retry', () => {
  const src = readFileSync(join(__dirname, 'datum-review.ts'), 'utf8')

  it('every lens dispatch allows one retry, never zero', () => {
    const lensCall = src.slice(src.indexOf('const reviewResults = await parallel'), src.indexOf('const allFindings'))
    expect(lensCall).toMatch(/maxRetries: 1/)
    expect(lensCall).not.toMatch(/maxRetries: 0/)
  })

  it('both review templates state a tool-call budget and tell the lens to answer with what it has, in the rules (before the first slot)', () => {
    for (const f of ['review-domain.md', 'review-correctness-spec-verify.md']) {
      const text = readFileSync(join(__dirname, 'prompts', f), 'utf8')
      const idx = text.search(/tool calls?/i)
      expect(idx, f).toBeGreaterThan(-1)
      expect(text, f).toMatch(/at most \d+ tool calls/i)
      expect(text, f).toMatch(/answer with (what|the findings) you have/i)
      expect(idx, `${f}: budget rule must sit in the stable prefix`).toBeLessThan(text.indexOf('{{'))
    }
  })

  it('the reviewer definition has room for a large diff (maxTurns 60)', () => {
    const def = readFileSync(join(__dirname, '..', '..', 'agents', 'datum-reviewer.md'), 'utf8')
    expect(def).toMatch(/^maxTurns: 60$/m)
  })
})
