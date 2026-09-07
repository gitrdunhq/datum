// review-branch.ts — the deterministic half of #375.
//
// A Review lens ran `git checkout <other branch>` in the operator's checkout,
// so the diff, the synthesis and the committed REVIEW-REPORT.md were all for
// the wrong branch. The agent definition (agents/datum-reviewer.md) proposes
// "never move HEAD"; this is the step that verifies it: the branch is read
// once before the lenses and once after, and a difference halts Review by
// name before the report is written into the wrong epic directory.
//
// tested-by: skills/src/datum-review.test.ts

/**
 * The named failure for a checkout that moved across the lenses, or null when
 * the branch is unchanged. A missing read on either side is *unchecked*, not a
 * halt: the branch steps are tolerant, and a batch that did not run must not
 * fail a review that is otherwise fine (the caller logs review_branch_unchecked).
 */
export function reviewBranchMoved(before: string, after: string): string | null {
  const b = (before || '').trim()
  const a = (after || '').trim()
  if (!b || !a || b === a) return null
  return (
    `review_branch_moved: the review lenses left the checkout on ${a}, but Review started on ${b} — ` +
    'the diff, the synthesis and REVIEW-REPORT.md would all be for the wrong branch'
  )
}
