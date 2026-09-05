// datum-closeout.ts receives the Act run id deterministically from datum-go
// (`{ ...phaseArgs, runId: resolvedRunId }`). It then asked an LLM to echo it
// back inside the collect JSON and preferred the echoed value
// (`ctx.run_id || runId`) — so when the model generated a fresh timestamp
// instead of echoing, Closeout ran against a run id that never existed
// (20260904-193814 vs Act's 20260904-190313, eedom run wf_2a5ede48-358).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-closeout.ts'), 'utf8')

describe('datum-closeout — run id provenance', () => {
  it('prefers the deterministic runId argument over the LLM-relayed ctx.run_id', () => {
    expect(src).toMatch(/const rid: string = runId \|\| ctx\.run_id/)
    expect(src).not.toMatch(/const rid: string = ctx\.run_id \|\| runId/)
  })
})
