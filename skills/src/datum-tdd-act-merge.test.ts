// datum-tdd-act-merge.ts must report what actually happened, not what it was
// asked to do. Its __workflowResult was `{ merged: a.completedIds.length > 0 }`
// — derived from the INPUT — so a batch whose squash-merge failed (the step
// logged SKIPPED_MERGE_FAILED) still returned merged: true, and datum-go /
// datum-tdd-act carried on to Validate/Review/Closeout on an unmerged epic
// (eedom dogfooding, run wf_2a5ede48-358).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const src = readFileSync(join(__dirname, 'datum-tdd-act-merge.ts'), 'utf8')

describe('datum-tdd-act-merge — result reflects the real merge outcome', () => {
  it('does not derive `merged` from the input completedIds', () => {
    expect(src).not.toMatch(/merged:\s*a\.completedIds\.length > 0/)
  })

  it('computes the outcome from the merge step exit code and reports a distinct failed flag', () => {
    // Outcome must be tied to the `merge` batch step result, and the result
    // object must carry `failed` so callers can tell "nothing to merge" from
    // "merge attempted and failed".
    expect(src).toMatch(/const mergeOk\b[^\n]*exit_code === 0/)
    expect(src).toMatch(/__workflowResult = \{[^}]*merged:[^,]*\bmergeOk\b[^}]*failed:[^,]*!mergeOk/)
  })
})
