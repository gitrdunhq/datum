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
