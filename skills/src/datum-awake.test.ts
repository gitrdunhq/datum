// ---------------------------------------------------------------------------
// FLOW.md design principle 2 ("an LLM proposes, it never asserts pass/fail")
// — a silent {language:'unknown', rules:[], ...} or placeholder-preamble
// fallback on an unparseable scan/distill response would get written to
// agent-preamble.md and committed as though it were real, degrading every
// future agent's preamble with no trace the scan/distill ever failed. Both
// must throw a named agent_output_unparseable failure instead of defaulting.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-awake.ts'), 'utf8')

describe('datum-awake — scan and distill use the strict parser', () => {
  it('imports parseAgentJsonStrict', () => {
    expect(src).toMatch(/import \{[^}]*parseAgentJsonStrict[^}]*\} from '\.\/shared\/utils'/)
  })

  it('scan is parsed with parseAgentJsonStrict labelled "scan-repo"', () => {
    expect(src).toMatch(/const scan = parseAgentJsonStrict<ScanResult>\(scanRaw as string, 'scan-repo'\)/)
  })

  it('distill is parsed with parseAgentJsonStrict labelled "distill-preamble"', () => {
    expect(src).toMatch(/const distill: DistillResult = parseAgentJsonStrict<DistillResult>\(distillRaw as string, 'distill-preamble'\)/)
  })

  it('no longer imports the lenient parseAgentJson (unused after both call sites went strict)', () => {
    expect(src).not.toMatch(/\bparseAgentJson\b/)
  })
})

// The distilled preamble is script-held content; it was handed to a
// runner as "Write these two files ... Then commit both" — the last
// prompt-driven commit in skills/src. Same treatment as the review report:
// byte-verified heredoc writes, then a commitFilesSteps batch.
// agent-preamble-full.md is gone (prompts audit 20260906): it was written on
// every awake and read by nothing, and the "agents fetch it on demand" path
// it described did not exist — a dead field under FLOW principle 1.
describe('datum-awake — the preamble is written and committed by batches', () => {
  it('writes the preamble through writeFileSteps in one batch and verifies its blob sha', () => {
    expect(src).not.toMatch(/Write these two files/)
    expect(src).not.toMatch(/Then commit both/)
    // preambleContent, not distill.preamble: the deterministic toolchain
    // conventions (#481) are appended to the distilled body before the write.
    expect(src).toMatch(/writeFileSteps\(\{ path: preamblePath, content: preambleContent, names: PREAMBLE_NAMES \}\)/)
    expect(src).toMatch(/writeFileFromSteps\(writeResult, \{ path: preamblePath, expectedSha: writeFileBlobSha\(preambleContent\), prefix: 'preamble', names: PREAMBLE_NAMES \}\)/)
    expect(src).not.toMatch(/preamble_full/)
  })

  it('commits through commitFilesSteps and halts as awake_commit_failed', () => {
    expect(src).toMatch(/commitFilesSteps\(\{ wt: '\.', files: \[preamblePath\], message: 'awake: regenerate agent preamble from repo scan' \}\)/)
    expect(src).toMatch(/commitFilesFromSteps\(await runBatch\(/)
    expect(src).toMatch(/throw new Error\(`awake_commit_failed: /)
  })
})

// ---------------------------------------------------------------------------
// #481 — TypeScript 7 removed the classic compiler API, so a GREEN agent that
// writes `ts.createSourceFile` (trained on TS 5) burns its retries against a
// module that exports only `version`. The pin is a fact in package.json, not
// a judgement: awake reads it with jq and a pure function decides, rather
// than asking the model to notice.
// ---------------------------------------------------------------------------

describe('datum-awake — the TypeScript-7 convention comes from package.json, deterministically', () => {
  it('reads the typescript pin with a tolerant jq batch step, not from the scan agent', () => {
    expect(src).toMatch(/name: 'ts-version'/)
    expect(src).toMatch(/jq -r '\.devDependencies\.typescript \/\/ \.dependencies\.typescript \/\/ empty' package\.json/)
    expect(src).toMatch(/tolerant: true/)
    expect(src).toMatch(/label: 'read-toolchain'/)
    // awake never calls configureAgentTypes, so its batches must not route
    // through stageOpts (which throws agent_types_unconfigured).
    expect(src).not.toMatch(/stageOpts\(/)
  })

  it('decides with the pure predicate and appends the line to the preamble it writes', () => {
    expect(src).toMatch(/import \{[^}]*toolchainConventionLines[^}]*\} from '\.\/shared\/toolchain'/)
    expect(src).toMatch(/toolchainConventionLines\(tsRange\)/)
    expect(src).toMatch(/const preambleContent =/)
    const decideIdx = src.indexOf('toolchainConventionLines(tsRange)')
    expect(decideIdx).toBeGreaterThan(-1)
    expect(decideIdx).toBeLessThan(src.indexOf('const writeSteps ='))
  })
})
