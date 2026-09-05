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
    const throwBlock = src.slice(src.indexOf('if (!ticketFile.exists)'))
    expect(throwBlock).toMatch(/issueNumber/)
  })

  it('the not-found error mentions freeText when one was passed and ignored', () => {
    const throwBlock = src.slice(src.indexOf('if (!ticketFile.exists)'))
    expect(throwBlock).toMatch(/freeText/)
  })

  it('still gives the plain "run datum init first" guidance when neither was passed', () => {
    const throwBlock = src.slice(src.indexOf('if (!ticketFile.exists)'), src.indexOf('if (!ticketFile.exists)') + 800)
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

  it('reads TICKET.md through the two-phase budgeted relay (probe → plan → inline → slot), never a single cat', () => {
    // A 31 KB SPEC relayed in one batch was spilled by the harness and the
    // runner fabricated the echo (caught as context_relay_mismatch). Large
    // files are handed to the agents by path + hash instead.
    expect(src).toMatch(/contextProbeSteps\(/)
    expect(src).toMatch(/contextRelayPlan\(/)
    expect(src).toMatch(/contextInlineSteps\(/)
    expect(src).toMatch(/contextFromRelay\(/)
    expect(src).toMatch(/const ticketContent: string = contextSlot\(ticketFile\)/)
    expect(src).not.toMatch(/readContextSteps\(|contextFromSteps\(/)
    // The addenda check must not depend on the content being inlined.
    expect(src).toMatch(/name: 'has-addenda'/)
    expect(src).toMatch(/stepStdout\(readBatch, 'has-addenda'\)/)
    expect(src).not.toMatch(/ticketContent\.includes\('## Addendum'\)/)
  })

  it('fails loud with context_relay_mismatch, not a silent fallback, when a relay batch returns nothing parseable', () => {
    // The throw lives in shared/context-relay.ts (contextRelayPlan on a
    // missing probe, contextFromRelay on a missing inline batch or a byte
    // mismatch); the script must route both batches through it.
    const relaySrc = readFileSync(join(__dirname, 'shared', 'context-relay.ts'), 'utf8')
    expect(relaySrc).toMatch(/context_relay_mismatch/)
    expect(src).toMatch(/contextRelayPlan\(readBatch/)
    expect(src).toMatch(/contextFromRelay\(readBatch, inlineBatch, relayPlan\)/)
  })

  it('runs the read batches through the deterministic cli stage, not a JSON-echoing agent call', () => {
    expect(src).toMatch(/batchCommandPrompt\(probeSteps\)/)
    expect(src).toMatch(/batchCommandPrompt\(inlineSteps\)/)
    expect(src).toMatch(/parseBatchResult\(/)
  })
})

// ---------------------------------------------------------------------------
// The phase gate verdict must come from the CLI's exit code via a
// deterministic batch step (shared/gate.ts), never from an LLM agent that
// ran `datum gate` and echoed the JSON back.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FLOW.md open gap 2 — a deferred ticketContent (contextSlot's Read
// instruction) is never verified as actually read. classify-ambiguity is the
// only agent call that both consumes ticketContent and parses a JSON object
// back — that's the one wired to the read-witness gate.
// ---------------------------------------------------------------------------

describe('datum-refine — read-witness gate on classify-ambiguity (FLOW.md open gap 2)', () => {
  it('appends contextWitnessInstruction([ticketFile]) to the classify-ambiguity prompt', () => {
    expect(src).toMatch(/from '\.\/shared\/context-relay'/)
    expect(src).toMatch(/contextWitnessInstruction\(\[ticketFile\]\)/)
    const idx = src.indexOf("label: 'classify-ambiguity'")
    const block = src.slice(Math.max(0, idx - 400), idx)
    expect(block).toMatch(/contextWitnessInstruction\(\[ticketFile\]\)/)
  })

  it('gates the parsed classify result with assertReadWitness before using it', () => {
    expect(src).toMatch(/assertReadWitness\(\[ticketFile\], classify\)/)
    const parseIdx = src.indexOf('const classify: ClassifyResult')
    const assertIdx = src.indexOf('assertReadWitness([ticketFile], classify)')
    expect(parseIdx).toBeGreaterThan(-1)
    expect(assertIdx).toBeGreaterThan(parseIdx)
  })

  it('the named failure lives in shared/context-relay.ts, not a bespoke throw here', () => {
    const relaySrc = readFileSync(join(__dirname, 'shared', 'context-relay.ts'), 'utf8')
    expect(relaySrc).toMatch(/context_read_unverified/)
  })
})

describe('datum-refine — deterministic gate verdict', () => {
  const src = readFileSync(join(__dirname, 'datum-refine.ts'), 'utf8')
  it('runs the gate through gateSteps/parseGateResult, not the util-run-gate LLM relay', () => {
    expect(src).not.toMatch(/util-run-gate/)
    expect(src).toMatch(/gateSteps\(/)
    expect(src).toMatch(/parseGateResult\(/)
  })
})

// ---------------------------------------------------------------------------
// FLOW.md design principle 2 ("an LLM proposes, it never asserts pass/fail")
// — the addenda-triage and ambiguity-classify results feed SPEC.md/QUESTIONS.md
// content directly; a silent fallback on unparseable output would drop real
// addenda or fabricate an ambiguity level with no trace. Both must throw a
// named agent_output_unparseable failure instead of defaulting.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SPEC.md + QUESTIONS.md (and ROADMAP.md after addenda triage) were written
// AND committed by the same agent, with its reply discarded: a runner that
// wrote the files but never committed — or committed with a trailer copied
// from the harness reminder — was indistinguishable from success, and
// nothing verified a deferred TICKET.md was read before the SPEC was
// written. Now the agents write and return a JSON receipt (carrying the
// read witness when TICKET.md was deferred); the script commits through
// commitFilesSteps and halts by name on a failed or empty commit.
// ---------------------------------------------------------------------------

describe('datum-refine — write and commit are separated; commits are batches', () => {
  const src = readFileSync(join(__dirname, 'datum-refine.ts'), 'utf8')

  it('no agent prompt commits', () => {
    expect(src).not.toMatch(/&& git commit -m/)
    expect(src).not.toMatch(/TASK 3 — Commit/)
  })

  it('the spec agent returns a receipt gated by the TICKET read witness, then the script commits SPEC.md + QUESTIONS.md', () => {
    const idx = src.indexOf("label: 'write-spec-and-questions'")
    expect(idx).toBeGreaterThan(-1)
    const before = src.slice(idx - 2000, idx)
    expect(before).toMatch(/Do NOT git add or git commit/)
    expect(before).toMatch(/contextWitnessInstruction\(\[ticketFile\]\)/)
    const after = src.slice(idx)
    expect(after).toMatch(/parseAgentJsonStrict<SpecReceipt>\(specRaw as string, 'write-spec-and-questions'\)/)
    expect(after).toMatch(/assertReadWitness\(\[ticketFile\], spec\)/)
    expect(after).toMatch(/commitRefineFiles\(\[`\$\{epicDir\}\/SPEC\.md`, `\$\{epicDir\}\/QUESTIONS\.md`\], 'refine: write SPEC.md \+ QUESTIONS.md'/)
  })

  it('ROADMAP.md is committed by the script only when addenda were roadmapped, and an unchanged file is a named failure', () => {
    expect(src).toMatch(/if \(triageResult\.roadmap_items\.length > 0\) \{/)
    expect(src).toMatch(/commitRefineFiles\(\['ROADMAP\.md'\], 'roadmap: triage items from refine'/)
  })

  it('commitRefineFiles wraps commitFilesSteps/commitFilesFromSteps and halts as refine_commit_failed', () => {
    expect(src).toMatch(/commitFilesSteps\(\{ wt: '\.', files, message \}\)/)
    expect(src).toMatch(/commitFilesFromSteps\(parseBatchResult\(/)
    expect(src).toMatch(/throw new Error\(`refine_commit_failed: /)
  })
})

describe('datum-refine — triage-addenda and classify-ambiguity use the strict parser', () => {
  const src = readFileSync(join(__dirname, 'datum-refine.ts'), 'utf8')

  it('imports parseAgentJsonStrict', () => {
    expect(src).toMatch(/import \{[^}]*parseAgentJsonStrict[^}]*\} from '\.\/shared\/utils'/)
  })

  it('triageResult is parsed with parseAgentJsonStrict labelled "triage-addenda"', () => {
    expect(src).toMatch(/triageResult = parseAgentJsonStrict<TriageResult>\(triageRaw as string, 'triage-addenda'\)/)
  })

  it('classify is parsed with parseAgentJsonStrict labelled "classify-ambiguity"', () => {
    expect(src).toMatch(/const classify: ClassifyResult = parseAgentJsonStrict<ClassifyResult>\(classifyRaw as string, 'classify-ambiguity'\)/)
  })

  it('no longer imports the lenient parseAgentJson (unused after both call sites went strict)', () => {
    expect(src).not.toMatch(/\bparseAgentJson\b/)
  })
})

// elonchesd wf_230050d5-e9e: the previous run's refine gate batch was
// classifier-refused, so the phase was never recorded; the relaunch re-ran
// refine from scratch, rewrote SPEC.md, regenerated QUESTIONS.md with five
// different questions and discarded the five answered ones. Refine must
// record itself complete when the gate already passes, and when it does
// re-run, answered questions are operator decisions carried forward.
describe('datum-refine — an already-complete refine is not regenerated; answered questions survive a re-run', () => {
  const src = readFileSync(join(__dirname, 'datum-refine.ts'), 'utf8')
  it('runs a structural early gate right after the Read phase and skips Analyze/Write when it passes', () => {
    const early = src.indexOf("gateSteps('refine', ' --approve')")
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(src.indexOf("phase('Analyze')"))
    expect(src).toMatch(/refine_already_complete/)
    expect(src).toMatch(/async function refineFromTicket\(/)
    expect(src).toMatch(/alreadyComplete \? null : await refineFromTicket\(\)/)
  })
  it('probes QUESTIONS.md alongside TICKET.md and hands the existing questions to the writer', () => {
    expect(src).toMatch(/const QUESTIONS_REL = 'docs\/epics\/\$__eb\/QUESTIONS\.md'/)
    expect(src).toMatch(/files: \[TICKET_REL, QUESTIONS_REL\]/)
    expect(src).toMatch(/existingQuestions/)
    const prompt = readFileSync(join(__dirname, 'prompts', 'refine-questions.md'), 'utf8')
    expect(prompt).toContain('{{existingQuestions}}')
    expect(prompt).toMatch(/verbatim/i)
  })
  it('verifies every previously answered question survived the rewrite before committing', () => {
    const check = src.indexOf('answersKeptFromSteps(')
    const commit = src.indexOf("'refine: write SPEC.md + QUESTIONS.md'")
    expect(check).toBeGreaterThan(0)
    expect(check).toBeLessThan(commit)
    expect(src).toMatch(/answeredQuestions\(/)
  })
})
