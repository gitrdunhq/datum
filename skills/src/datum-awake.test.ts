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

// The distilled preambles are script-held content; they were handed to a
// runner as "Write these two files ... Then commit both" — the last
// prompt-driven commit in skills/src. Same treatment as the review report:
// byte-verified heredoc writes, then a commitFilesSteps batch.
describe('datum-awake — preambles are written and committed by batches', () => {
  it('writes both files through writeFileSteps in one batch and verifies each blob sha', () => {
    expect(src).not.toMatch(/Write these two files/)
    expect(src).not.toMatch(/Then commit both/)
    expect(src).toMatch(/writeFileSteps\(\{ path: preamblePath, content: distill\.preamble, names: PREAMBLE_NAMES \}\)/)
    expect(src).toMatch(/writeFileSteps\(\{ path: fullPath, content: distill\.preamble_full, names: FULL_NAMES \}\)/)
    expect(src).toMatch(/writeFileFromSteps\(writeResult, \{ path: preamblePath, expectedSha: writeFileBlobSha\(distill\.preamble\), prefix: 'preamble', names: PREAMBLE_NAMES \}\)/)
    expect(src).toMatch(/writeFileFromSteps\(writeResult, \{ path: fullPath, expectedSha: writeFileBlobSha\(distill\.preamble_full\), prefix: 'preamble_full', names: FULL_NAMES \}\)/)
  })

  it('commits through commitFilesSteps and halts as awake_commit_failed', () => {
    expect(src).toMatch(/commitFilesSteps\(\{ wt: '\.', files: \[preamblePath, fullPath\], message: 'awake: regenerate agent preamble from repo scan' \}\)/)
    expect(src).toMatch(/commitFilesFromSteps\(parseBatchResult\(/)
    expect(src).toMatch(/throw new Error\(`awake_commit_failed: /)
  })
})
