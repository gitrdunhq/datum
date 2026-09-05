// Deterministic pre-classification of lane failures before they ever reach an
// LLM triage prompt. The Act pipeline already stamps every infrastructure /
// tooling failure with a stable machine-readable prefix on `LaneOutcome.error`
// (see skills/src/datum-tdd-act-lane.ts, datum-validate.ts, datum-go.ts,
// datum-plan.ts, datum-refine.ts, shared/utils.ts groupBlockedByRoot/
// computeBlockedLanes). When that prefix is present the category is already
// known with certainty — the LLM re-guessing from the error text alone is how
// #387 (blamed the RED agent for skeleton stubs left in the ROOT checkout)
// and #392 (blamed a "fixtures-only lane" when the count-gate diffed the
// wrong range) went wrong. This module is pure and has no agent/IO dependency
// so it can run before any `agent()` call.

export type TriageClassifyCategory =
  | 'infrastructure'
  | 'workflow_bug'
  | 'lane_plan'
  | 'agent_behavior'
  | 'test_quality'
  | 'dependency'
  | 'unknown'

export interface TriageClassification {
  category: TriageClassifyCategory
  confidence: 'deterministic' | 'heuristic'
  reason: string
}

interface PrefixRule {
  /** Matches anywhere in the error string — every prefix above is emitted as `<prefix>: <detail>`. */
  test: RegExp
  category: TriageClassifyCategory
  reason: string
}

// Order matters: more specific prefixes (e.g. `count_gate_no_output`) must be
// checked before shorter prefixes that could also match a substring of them.
const PREFIX_RULES: PrefixRule[] = [
  // ── infrastructure: git/tooling/relay/gate plumbing the pipeline itself runs ──
  {
    test: /\blane_intake_failed\b/,
    category: 'infrastructure',
    reason: 'lane_intake_failed: the intake batch step (git/tooling) did not return a result — not a code or plan defect.',
  },
  {
    test: /\bcount_gate_no_output\b/,
    category: 'infrastructure',
    reason: 'count_gate_no_output: the test-count-gate tool produced no parseable JSON — a tooling failure, not evidence about the tests it was supposed to count.',
  },
  {
    test: /\bcount_gate_failed\b/,
    category: 'infrastructure',
    reason: 'count_gate_failed: the test-count-gate tool itself failed to run/produce JSON — tooling, not lane content.',
  },
  {
    test: /\bmerge_failed\b|\bdep_merge_failed\b/,
    category: 'infrastructure',
    reason: 'merge_failed (incl. dep_merge_failed): git merge/squash mechanics failed — infrastructure, not the lane\'s code.',
  },
  {
    test: /\bownership_check_failed\b/,
    category: 'infrastructure',
    reason: 'ownership_check_failed: the ownership-diff step itself did not run or returned no result — distinct from an actual violation (file_ownership_violation), which is agent behavior.',
  },
  {
    test: /\bvalidate_run_failed\b/,
    category: 'infrastructure',
    reason: 'validate_run_failed: the independent test-verify run at the Validate stage did not execute — a runner/tooling failure.',
  },
  {
    test: /\blane_plan_relay_mismatch\b/,
    category: 'infrastructure',
    reason: 'lane_plan_relay_mismatch: the relayed lane plan shape differs from the file on disk — a pipeline plumbing bug, not a plan-quality problem.',
  },
  {
    test: /\bcontext_relay_mismatch\b/,
    category: 'infrastructure',
    reason: 'context_relay_mismatch: a context file/byte-count relay between agents failed — pipeline plumbing.',
  },
  {
    test: /no worktree path/,
    category: 'infrastructure',
    reason: 'no worktree path: setup never produced an isolated worktree for the lane — infrastructure, and specifically why lane files must never be looked for in the ROOT checkout (#387).',
  },

  // ── lane_plan: the plan itself asked for something contradictory/impossible ──
  {
    test: /\bcontract_conflict\b/,
    category: 'lane_plan',
    reason: 'contract_conflict: preflight found the lane\'s acceptance criteria conflict with an existing contract — a plan defect.',
  },
  {
    test: /\bscope_gap\b/,
    category: 'lane_plan',
    reason: 'scope_gap: the lane plan\'s declared files/scope do not cover what the acceptance criteria require — a plan defect.',
  },
  {
    test: /\bno_test_files\b/,
    category: 'lane_plan',
    reason: 'no_test_files: classifyFiles found no test files for the lane at all — the lane plan did not assign any, not something the RED agent could have fixed.',
  },

  // ── agent_behavior: the agent actively violated a hard rule ──
  {
    test: /\bplaceholder_assertions\b/,
    category: 'agent_behavior',
    reason: 'placeholder_assertions: the RED agent committed placeholder/pass-only assertions instead of real tests.',
  },
  {
    test: /\bno_new_test_functions_committed\b/,
    category: 'agent_behavior',
    reason: 'no_new_test_functions_committed: the RED agent did not actually add the required new test functions.',
  },
  {
    test: /\bgreen_blindness_violation\b/,
    category: 'agent_behavior',
    reason: 'green_blindness_violation: the GREEN agent read RED\'s test file contents when it should not have.',
  },
  {
    test: /\bfile_ownership_violation\b/,
    category: 'agent_behavior',
    reason: 'file_ownership_violation: the agent wrote outside its allowed file set — a real, confirmed violation (vs. ownership_check_failed, which is the check tool itself failing).',
  },

  // ── test_quality vs agent_behavior for *_verify_failed / skeptic_broken:
  // both are plausible. Classified as agent_behavior here because in every
  // case the *implementing* agent (GREEN/REFACTOR) is the one whose claimed
  // result (tests_pass / "verified") disagrees with an independent re-run or
  // an adversarial read — i.e. the agent's own output is what's wrong, not a
  // pre-existing weak test the RED agent wrote (that case is covered
  // separately by placeholder_assertions / low reflect scores upstream).
  {
    test: /\bskeptic_broken\b/,
    category: 'agent_behavior',
    reason: 'skeptic_broken: adversarial read-only review found confirmed bugs in the GREEN implementation that survived a retry.',
  },
  {
    test: /\bgreen_verify_failed\b/,
    category: 'agent_behavior',
    reason: 'green_verify_failed: independent test-verify disagreed with the GREEN agent\'s self-reported tests_pass.',
  },
  {
    test: /\brefactor_verify_failed\b/,
    category: 'agent_behavior',
    reason: 'refactor_verify_failed: independent test-verify after REFACTOR disagreed with the agent\'s self-reported result.',
  },
]

/**
 * Deterministically classify a lane failure from the pipeline-produced
 * `error` string and `stage`, before ever asking an LLM to categorise it.
 * Returns `confidence: 'deterministic'` whenever a known prefix or the
 * SKIPPED/blocked convention matches; otherwise `'unknown'` /
 * `confidence: 'heuristic'` so the caller knows the LLM must actually reason
 * about it (and must not be told a false category).
 */
export function classifyLaneError(
  error: string | undefined,
  stage: string | undefined,
): TriageClassification {
  // Dependency: a lane that never ran its own logic because an upstream lane
  // failed/was blocked. groupBlockedByRoot already groups these under their
  // root cause — they are consequences, not independent bugs to diagnose.
  if (stage === 'SKIPPED' || /^blocked[:\s]/.test(error || '')) {
    return {
      category: 'dependency',
      confidence: 'deterministic',
      reason: 'stage=SKIPPED or a "blocked: ..." error — this lane never ran; it is a consequence of an upstream root failure, not an independent bug.',
    }
  }

  const text = error || ''
  for (const rule of PREFIX_RULES) {
    if (rule.test.test(text)) {
      return { category: rule.category, confidence: 'deterministic', reason: rule.reason }
    }
  }

  return {
    category: 'unknown',
    confidence: 'heuristic',
    reason: 'No known machine-generated prefix matched — the LLM must actually reason about this failure from the raw error text.',
  }
}
