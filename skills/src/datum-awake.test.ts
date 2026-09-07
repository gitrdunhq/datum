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
    expect(src).toMatch(/writeFileSteps\(\{ path: preamblePath, content: distill\.preamble, names: PREAMBLE_NAMES \}\)/)
    expect(src).toMatch(/writeFileFromSteps\(writeResult, \{ path: preamblePath, expectedSha: writeFileBlobSha\(distill\.preamble\), prefix: 'preamble', names: PREAMBLE_NAMES \}\)/)
    expect(src).not.toMatch(/preamble_full/)
  })

  it('commits through commitFilesSteps and halts as awake_commit_failed', () => {
    expect(src).toMatch(/commitFilesSteps\(\{ wt: '\.', files: \[preamblePath\], message: 'awake: regenerate agent preamble from repo scan' \}\)/)
    expect(src).toMatch(/commitFilesFromSteps\(await runBatch\(/)
    expect(src).toMatch(/throw new Error\(`awake_commit_failed: /)
  })
})
