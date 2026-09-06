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
    test: /\btest_env_missing\b/,
    category: 'infrastructure',
    reason: 'test_env_missing: the lane worktree has no test environment (runner/interpreter not found) — dependencies were not linked or installed into the worktree; the suite\'s exit code is not evidence about the code. Fix: worktree_link_dirs in .datum/config.json / install deps in the main checkout.',
  },
  {
    test: /\bgreen_blocked_needs_write\b/,
    category: 'lane_plan',
    reason: 'green_blocked_needs_write: GREEN stopped honestly because passing requires a file outside the lane\'s allowed_write_files — the lane plan under-scoped the lane. Fix: add the listed path(s) to the lane\'s `files` and re-run act; the partial implementation is kept as a wip commit on the lane branch.',
  },
  {
    test: /\bgreen_edited_tests\b/,
    category: 'agent_behavior',
    reason: 'green_edited_tests: the GREEN agent modified the lane\'s own test files (or rewrote the RED commit) — a stage discipline violation by the agent, retried once from the RED commit with the hint; the lane failed only if it did it again.',
  },
  {
    test: /\brunner_permission_denied\b/,
    category: 'infrastructure',
    reason: 'runner_permission_denied: the host permission classifier refused the datum-cli runner\'s batch (typically git reset --hard / clean -fd inside datum\'s own scratch worktree) and it replied in prose. Fix is an allow-rule for those commands on the .datum/worktrees path, not a code or plan change.',
  },
  // Batch wrapper failures come BEFORE lane_intake_failed: they surface
  // through it ("lane_intake_failed: ...: batch_script_corrupt ...") and the
  // more specific name is the one the operator needs.
  {
    test: /\bbatch_script_corrupt\b/,
    category: 'infrastructure',
    reason: 'batch_script_corrupt: the datum-cli runner re-typed the batch script and the hash check refused to run it, twice (caliper eedom wf_4f739141-c8c: a dropped quote). Nothing in the batch ran; a runner transcription failure, not a code or plan defect.',
  },
  {
    test: /\bbatch_root_missing\b/,
    category: 'infrastructure',
    reason: 'batch_root_missing: the repo root recorded at boot no longer exists, so the batch refused to run anywhere else (elonchesd wf_29721006-d27: a batch that ran in a second worktree). Nothing in the batch ran; a pipeline/environment failure, not a code or plan defect.',
  },
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
    test: /\bgreen_verify_unavailable\b/,
    category: 'infrastructure',
    reason: 'green_verify_unavailable: the independent post-GREEN test-verify batch returned nothing parseable (twice), so there is no exit code — no evidence about the code either way (elonchesd wf_dee84cc2-e64: a GREEN that passed 434/434 was filed as "GREEN lied"). A runner failure, not agent behaviour.',
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
  {
    test: /\bgreen_no_result\b/,
    category: 'infrastructure',
    reason: 'green_no_result: the GREEN agent returned nothing at all (maxTurns cap in agents/datum-green.md, an API error, or a skip) — a capacity/infra failure like lane_intake_failed\'s "no result", not a claim about what the agent did with the code.',
  },
  {
    test: /\bred_no_result\b/,
    category: 'infrastructure',
    reason: 'red_no_result: the RED agent returned nothing at all (maxTurns cap in agents/datum-red.md, an API error, or a skip) — same capacity/infra bucket as green_no_result, not agent behavior about the tests.',
  },
  {
    test: /\brefactor_no_result\b/,
    category: 'infrastructure',
    reason: 'refactor_no_result: the REFACTOR agent returned nothing at all (maxTurns cap in agents/datum-refactor.md, an API error, or a skip) — same capacity/infra bucket as green_no_result/red_no_result.',
  },
  {
    test: /\bagent_types_unconfigured\b/,
    category: 'infrastructure',
    reason: 'agent_types_unconfigured: stageOpts() was called before configureAgentTypes() — a pipeline wiring/ordering bug, not anything the lane\'s agents did.',
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
    test: /\bno_new_tests_written\b/,
    category: 'agent_behavior',
    reason: 'no_new_tests_written: the lane runner\'s post-RED count from the epic merge-base (after a7abd94) found no new test functions — same agent-behavior signal as no_new_test_functions_committed, just measured from a different baseline.',
  },
  {
    test: /\bcontext_read_unverified\b/,
    category: 'agent_behavior',
    reason: 'context_read_unverified: assertReadWitness found the agent did not evidence reading a deferred large file it was required to read before acting — the agent skipped a required step, not a pipeline bug.',
  },
  {
    test: /\bagent_output_unparseable\b/,
    category: 'agent_behavior',
    reason: 'agent_output_unparseable: parseAgentJsonStrict found the agent returned no parseable JSON at all — an agent output-format failure, not tooling (contrast with count_gate_no_output, where the *tool* being called is what failed).',
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
  {
    test: /\brefactor_failed\b/,
    category: 'agent_behavior',
    reason: 'refactor_failed: the REFACTOR agent itself reported a real failure_reason (not "nothing to change"). agent_behavior, not infrastructure: by the time REFACTOR is dispatched the runner has already independently verified the suite is green at the lane\'s HEAD (the intake-verify gate, #331) — a suite that was already red would have been caught upstream as green_stale/lane_intake_failed before REFACTOR ever ran, so a failure here is about what the REFACTOR agent did, not stale pipeline state.',
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

export type TriageDestination = 'datum' | 'consumer' | 'none'

// Where a classified failure's issue (if any) belongs. #417 landed a
// skeptic-confirmed CONSUMER-repo code bug ("resolveConvert recomputes
// fog-of-war from stale board state" in Shroud Chess) into datum's own
// tracker, because datum-tdd-act-triage.ts hardcodes `gh issue create --repo
// gitrdunhq/datum` for every failure regardless of what actually broke. This
// map is the single source of truth for which categories mean *datum's own*
// pipeline/tooling is at fault (file to datum) vs. which mean the lane's
// work / the consumer repo's code is what's wrong (never datum's tracker —
// the consumer may have no configured remote, so datum does not attempt to
// file there either; it only stops misfiling).
//
// Declared as a `Record<TriageClassifyCategory, TriageDestination>` so
// TypeScript's exhaustiveness check fails to compile the moment a new
// category is added to `TriageClassifyCategory` without a destination
// decision here (the #417 failure mode: a new category silently defaulting
// to 'datum' and misfiling a consumer-code finding).
const DESTINATION_BY_CATEGORY: Record<TriageClassifyCategory, TriageDestination> = {
  // datum's own pipeline/tooling categories — the lane never got a fair run.
  infrastructure: 'datum',
  workflow_bug: 'datum',
  // The lane's work or the consumer repo's code is what's actually wrong —
  // never datum's tracker. Includes lane_plan (contract_conflict, scope_gap:
  // the plan asked for something the lane's own scope/contracts don't
  // support), agent_behavior (skeptic_broken, green_verify_failed,
  // placeholder_assertions, etc.: a real finding about the implementation or
  // tests the lane produced), and test_quality (weak/wrong assertions).
  lane_plan: 'consumer',
  agent_behavior: 'consumer',
  test_quality: 'consumer',
  // No known pipeline prefix matched — never assume datum is at fault
  // without positive evidence; treat as a consumer-code finding to log, not
  // as a reason to file against datum.
  unknown: 'consumer',
  // Already-skipped consequence of an upstream root failure — never filed
  // anywhere on its own.
  dependency: 'none',
}

/**
 * Pure routing decision for where (if anywhere) a classified lane failure's
 * issue belongs. `error` is accepted for symmetry with `classifyLaneError`
 * and to leave room for future error-text-based overrides, but the decision
 * today is entirely a function of `classification.category`.
 */
export function triageDestination(
  classification: TriageClassification,
  _error: string | undefined,
): TriageDestination {
  return DESTINATION_BY_CATEGORY[classification.category]
}
