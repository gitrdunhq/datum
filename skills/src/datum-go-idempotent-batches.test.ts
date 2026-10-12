// The read-only (or append-only) batches datum-go runs before any phase opt
// into runBatch's prose retry. Run wf_b703fe46-bf9 died at boot because the
// preflight-gitignore runner returned the check's own JSON instead of the
// step array (runner_no_json), and a non-idempotent batch is never retried.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-go.ts'), 'utf8')

function callFor(label: string): string {
  const at = src.indexOf(`label: '${label}'`)
  expect(at, `no runBatch call labelled ${label}`).toBeGreaterThan(-1)
  const start = src.lastIndexOf('runBatch(', at)
  return src.slice(start, at + 200)
}

describe('datum-go boot and preflight batches are idempotent', () => {
  for (const label of ['boot', 'preflight-tool-check', 'preflight-gitignore']) {
    it(`${label} passes idempotent: true to runBatch`, () => {
      // Catches: one runner slip on a read-only boot batch halting the whole run.
      expect(callFor(label)).toMatch(/idempotent:\s*true/)
    })
  }
})
