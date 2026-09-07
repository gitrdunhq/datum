# SPEC — Integration lanes, slice 2a: an integration lane runs RED-only, end to end

## 1. Summary

Slice 1 (epic `datum/integration-lanes`, closed 2026-09-06) made Properties emit an `## Integration Invariants` table and made Plan schedule one `task-INT-<n>` lane per merge frontier with `kind: "integration"` and `expect_tests_pass: true`. This slice teaches the lane runner (`skills/src/datum-tdd-act-lane.ts`) to actually treat that lane differently at runtime: run RED only, verify the (already-merged) tests independently, and halt with a named, classifiable failure — `integration_failed` — that points at the covered tasks, not at the integration lane itself. Without this slice, an integration lane is scheduled but executed exactly like a task lane (RED must fail, GREEN required, skeptic panel, REFACTOR), which is backwards for code that has already merged and whose tests are the finding, not something to fix.

## 2. Context

- **Runner**: `runLane` in `skills/src/datum-tdd-act-lane.ts` (~1740 lines) already has a precedent fast path for a different lane variant — `isStructural` (lines 443-449) — which skips straight to `runRefactor` and returns `{status:'completed', stage:'REFACTOR'}`. This slice adds an analogous `isIntegration` fast path that instead stops *after* RED, never reaching `runRefactor` (line 1479, called 3x) or `runSkepticPanel` (line 1428, called 2x post-GREEN).
- **Post-RED batch**: `postRedSteps` in `skills/src/shared/lane-steps.ts` already bundles count-gate, placeholder-scan, and ownership-diff into one `datum-cli` batch call (used at `datum-tdd-act-lane.ts:768`), and already accepts an optional `verifyTestCmd` parameter that appends a `test-verify` step read via `testExitCode(stepStdout(...))` (line 832). This is the exact "post-RED deterministic batch" and "independent verify" R1/R2 require — no new command-runner call is needed, only a conditional argument.
- **Types**: `Lane.kind` in `skills/src/shared/types.ts` is currently `'structural' | 'behavioral'` only — `'integration'` is not yet a member, even though `datum/gate.py`, `datum/lane_spec_export.py`, and `datum/skeleton_creator.py` already treat `kind == 'integration'` as live on the Python side. `Lane.expect_tests_pass` does not exist on the TS `Lane` interface at all, though it is already produced by `datum/integration_invariants.py:195`, threaded through `datum/lane_plan.py:677`, and spread into the per-lane spec file by `lane_spec_export.py` (`**lane`, lines 172-176) — so the RED agent's `.datum/lane-spec.json` already carries it today. It is absent from `datum/lane_plan_digest.py`'s `_LANE_FIELDS` tuple, so the TS runner's in-memory digest never sees it — this slice adds it there.
- **Classification**: `TriageClassifyCategory` in `skills/src/shared/triage-classify.ts` is `'infrastructure' | 'workflow_bug' | 'lane_plan' | 'agent_behavior' | 'test_quality' | 'dependency' | 'unknown'`. `PREFIX_RULES` is a linear, in-order list of `{test: RegExp, category, reason}`. No rule or category currently distinguishes "code defect in already-merged work" from "the RED agent misbehaved" (`agent_behavior`), which R3 says is the wrong bucket for `integration_failed`.
- **Export**: `datum lane-spec-export` (backed by `datum/lane_spec_export.py`) already spreads the full lane dict — including `expect_tests_pass` and `depends_on` — into the written spec file via `**lane`. The printed CLI summary line (`{task_id, path, bytes, sha, spec_hash, ac_count}`) does not include these fields; per the ticket's stated pattern (agents read facts from the hash-verified file, not from LLM-relayed digests or printed summaries), the runner and RED agent should get `expect_tests_pass`/`depends_on` from the spec file/digest, not the printed line.
- **Docs**: `docs/FLOW.md` §3 has a mermaid diagram of only the task-lane RED→GREEN→REFACTOR path; §5 has a "Closed" ledger entry for slice 1 describing Plan-side scheduling only. `SKILL.md` line 141 currently calls `integration_failed` "reserved."

## 3. Requirements

### R1 — Integration lane runs RED-only

`runLane` in `skills/src/datum-tdd-act-lane.ts` detects `lane.kind === 'integration'` (or, equivalently, `lane.expect_tests_pass === true`) and:
1. Runs RED exactly once.
2. Runs the existing post-RED deterministic batch (count gate, placeholder scan, ownership diff) via `postRedSteps`, passing the lane's test command as `verifyTestCmd` so the batch also runs the independent verify (`test-verify` step) in the same call — no second `runBatch`/command-runner invocation.
3. Does not call `runGreen`/GREEN dispatch, `runSkepticPanel`, or `runRefactor`.
4. Builds the RED prompt for an `expect_tests_pass` lane to include, verbatim as a substring: `This lane covers invariants: <id>, <id>...` (invariant ids = the leading `ID:` tokens of the lane's acceptance criteria, in order) and the sentence `The code under test is already merged: these tests must PASS on your first run; a failing test is a finding, report it, do not weaken it.`

**Acceptance criteria:**
- AC1.1: A vitest test with a fake agent, given a lane with `kind: 'integration'`, observes RED called exactly once.
- AC1.2: The same test observes zero calls into GREEN dispatch, `runSkepticPanel`, and `runRefactor` (call-log/label assertions, following the `datum-tdd-act-lane.calls.test.ts` convention).
- AC1.3: The same test observes the post-RED batch (`datum-cli`/command-runner call) invoked exactly once, and no additional command-runner call beyond it.
- AC1.4: A source-text or rendered-prompt assertion confirms the RED prompt for an `expect_tests_pass` lane contains the invariant id substrings and the string "must PASS".

### R2 — Independent verify decides the lane outcome

The `test-verify` step's exit code (read via the existing `testExitCode(stepStdout(...))` helper) decides the lane:
- Exit `0`: lane outcome is `{status: 'completed', stage: 'RED'}`; `follow_ups` unchanged from whatever RED/post-RED produced.
- Non-zero exit: lane outcome is `{status: 'failed', error: 'integration_failed: covered <task-ids>; invariants <invariant-ids> (independent verify exit=<n>)'}`, where `<task-ids>` is the lane's `depends_on` array joined `, ` in order, and `<invariant-ids>` is the acceptance-criteria-derived id list joined `, ` in order, exactly matching the format: `integration_failed: covered task-002, task-003; invariants INV-01, INV-03 (independent verify exit=1)`.
- Null exit (verify step absent, batch missing/refused, or no `TEST_EXIT=` line printed): lane outcome is `{status: 'failed', error: 'green_verify_unavailable: ...'}` via the same code path GREEN already uses — never treated as a pass.

**Acceptance criteria:**
- AC2.1: Fake-agent test with `test-verify` exit 0 asserts `result.results.T1.status === 'completed'` and `stage === 'RED'`.
- AC2.2: Fake-agent test with `test-verify` exit 1 asserts `result.results.T1.status === 'failed'` and `error` starts with `integration_failed:` and contains the lane's `depends_on` ids and the invariant ids in the specified format.
- AC2.3: Fake-agent test with the `test-verify` step omitted/refused asserts `error` starts with `green_verify_unavailable:` and status is not `completed`.

### R3 — Classifier maps `integration_failed` to a code-defect category

`skills/src/shared/triage-classify.ts` adds a `PREFIX_RULES` entry matching `/^integration_failed:/` that classifies to a new category distinct from `agent_behavior` (e.g. `code_defect`), with `reason` carrying the covered task ids extracted from the error string via a regex on `covered ([^;]+)` (per the operator-confirmed format), so downstream consumers (halt message, GitHub issue filer) can read which merged tasks broke the invariant directly from `reason`.

**Acceptance criteria:**
- AC3.1: `classify('integration_failed: covered task-002, task-003; invariants INV-01, INV-03 (independent verify exit=1)')` returns a category that is not `agent_behavior` (the new code-defect category) and a `reason` string containing `task-002` and `task-003`.
- AC3.2: Existing classifier tests for other prefixes (every prefix already in `PREFIX_RULES`, including `lane_intake_failed`, `green_verify_unavailable` and `count_gate_failed`) remain unchanged and passing (no regression to `PREFIX_RULES` ordering).

### R4 — `lane-spec-export` and the digest carry `expect_tests_pass` and covered task ids

1. `datum/lane_plan_digest.py`'s `_LANE_FIELDS` tuple gains `'expect_tests_pass'` alongside the existing `'depends_on'` and `'kind'`, so the TS runner's in-memory `LanePlanDigest` object carries the flag without opening the spec file.
2. `skills/src/shared/types.ts`'s `Lane` interface gains `kind?: 'structural' | 'behavioral' | 'integration'` and `expect_tests_pass?: boolean`.
3. The lane spec file written by `datum lane-spec-export` (already spreading `**lane`) continues to include `expect_tests_pass` and `depends_on` — verified by an assertion, not re-implemented, since it already works via the existing spread.

**Acceptance criteria:**
- AC4.1: A test (Python, pytest) asserts `_LANE_FIELDS` contains `'expect_tests_pass'` and that a digest built from a lane dict with `expect_tests_pass: True` carries it through.
- AC4.2: A TS type-level or unit test confirms `Lane` accepts `kind: 'integration'` and `expect_tests_pass: boolean` without a cast.
- AC4.3: An existing or new `lane_spec_export` test asserts the written spec JSON for an integration lane contains `expect_tests_pass: true` and `depends_on` matching the lane's covered tasks.

### R5 — Docs updated

1. `docs/FLOW.md` §3 gains one paragraph beside the existing task-lane diagram describing the integration-lane path: RED → post-RED batch + independent verify → completed-at-RED or `integration_failed`.
2. `docs/FLOW.md` §5's slice-1 ledger entry is edited to state RED-only execution shipped (not just Plan-side scheduling).
3. `SKILL.md` line 141 is edited to list `integration_failed` as a live failure name (dropping "reserved").

**Acceptance criteria:**
- AC5.1: `docs/FLOW.md` contains a paragraph in §3 mentioning "integration lane" and "RED" adjacent to the existing task-lane diagram.
- AC5.2: `docs/FLOW.md` §5's slice-1 entry text no longer implies only scheduling is done.
- AC5.3: `SKILL.md` no longer contains the word "reserved" adjacent to `integration_failed`.

### R6 — Real ride: this epic's own Act exercises the path

This epic's Properties phase must derive at least one integration invariant across its own tasks; Plan must schedule at least one `task-INT-<n>` lane; and Act must run that lane RED-only to completion (or to `integration_failed`, which is also a valid, informative outcome — but a null/never-scheduled outcome is not).

**Acceptance criteria:**
- AC6.1: This epic's `PROPERTIES.md` contains an `## Integration Invariants` table with at least one row.
- AC6.2: This epic's `lane-plan.json` (or tasks.json) contains at least one lane with `kind: 'integration'`.
- AC6.3: This epic's Act log shows one `task-INT-<n>` lane reaching `stage: RED` with a terminal status (`completed` or `integration_failed`), and no GREEN/skeptic/REFACTOR calls logged for it.
- AC6.4: If Plan produces zero integration lanes for this epic, that is treated as a slice defect (task reopened / gate failure), not a passing run — per the ticket's explicit instruction.

## 4. Failure Modes

| Failure | Handling |
|---|---|
| `test-verify` step missing/refused/empty from the post-RED batch | `green_verify_unavailable: ...`, status not `completed`, never treated as a pass (R2) |
| `test-verify` exits non-zero (merged tests genuinely fail) | `integration_failed: covered <ids>; invariants <ids> (independent verify exit=<n>)`, classified as code-defect category naming the covered tasks (R2, R3) |
| Lane has `kind: 'integration'` but `expect_tests_pass` is missing/false in the spec (data drift between Plan and lane-plan digest) | Treat `kind === 'integration'` as the authoritative signal for the RED-only fast path; log a warning if `expect_tests_pass` disagrees, but do not silently fall back to full task-lane flow (avoids running GREEN/REFACTOR against already-merged code) |
| Post-RED count-gate/placeholder-scan/ownership-diff fails for an integration lane | Existing `count_gate_failed`/ownership failure semantics apply unchanged — these checks run identically to a task lane per R1 |
| Properties/Plan (slice 1) not actually producing integration lanes in a real epic run | Surfaced by R6 as a slice defect, not silently passed; the plan gate's existing `plan_not_sliced` warning is out of scope to convert into a halt (explicitly deferred to 2c) |
| `integration_failed:` string format drifts from the classifier's regex expectation | Both the error-string builder (runner) and the extractor (classifier) are specified byte-for-byte in R2/R3 and covered by tests in the same PR, preventing silent divergence |
| Digest (`_LANE_FIELDS`) omits `expect_tests_pass` after this change (regression) | AC4.1 pins this field's presence explicitly |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| No new command-runner call per lane | Post-RED batch + independent verify remain one `datum-cli` invocation, as today (R1, R2) |
| No new phase | Integration-lane handling lives entirely inside the existing Act/lane-runner phase |
| Backward compatibility | Existing structural/behavioral lane paths (`isStructural` fast path, task-lane RED→GREEN→REFACTOR) are unchanged; new `Lane.kind` union member and `expect_tests_pass` field are additive/optional |
| Test coverage | Every new branch (RED-only fast path, verify exit 0/non-zero/null, classifier rule) has a corresponding vitest/pytest assertion per the Acceptance section |
| Minimal diff | Changes confined to `skills/src/datum-tdd-act-lane.ts`, `skills/src/shared/triage-classify.ts`, `skills/src/shared/types.ts`, `datum/lane_plan_digest.py`, `docs/FLOW.md`, `SKILL.md`, plus their tests — no edits to generated `skills/*.js` bundles directly (build regenerates them) |

## 6. Out of Scope

- The prove-it-can-fail mutation check (`integration_test_vacuous`) — slice 2b.
- Turning the plan gate's `plan_not_sliced` warning into a halt — slice 2c.
- A structured `taskIds: string[]` field on `TriageClassification` (string-embedding in `reason` is sufficient for this slice per operator decision; revisit if a real consumer needs structure — no producer without a consumer).
- Refine pre-checking that an epic's Properties will generate at least one invariant before Plan/Act run (R6's "defect, not a pass" is enforced by observing this epic's own real run, not by adding a new Refine-phase gate).
- Any change to how Properties derives invariants or Plan schedules lanes (`datum/integration_invariants.py`, `datum/lane_plan.py`) beyond the two field additions in R4 — that logic is slice 1, already shipped.

## 7. Open Questions

None outstanding — all material ambiguities raised during scan (error-string format, verify batching, classification field shape, RED prompt shape, verify-unavailable semantics) were resolved by the operator in QUESTIONS.md (Q1–Q5, 2026-09-06) and are incorporated into R1–R3 above as decided requirements.

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | Slice 1 (epic `datum/integration-lanes`) has merged; Properties/Plan already derive and schedule integration lanes | Ticket states epic closed 2026-09-06; `datum/integration_invariants.py` and `datum/lane_plan.py:655-679` confirmed present in scan | confirmed | n/a |
| 2 | Lane specs already carry `expect_tests_pass` and `depends_on` to the RED agent via `lane-spec-export`'s `**lane` spread | Verified in scan: `lane_spec_export.py:172-176` | confirmed | n/a |
| 3 | Independent verify is folded into the existing `postRedSteps` batch via its optional `verifyTestCmd` param, not a second batch call | Operator-confirmed in QUESTIONS.md Q2 | decided | n/a |
| 4 | `integration_failed:` error string format is exactly `integration_failed: covered <ids>; invariants <ids> (independent verify exit=<n>)` | Operator-confirmed in QUESTIONS.md Q1 | decided | n/a |
| 5 | Task ids come from `depends_on` in lane order; invariant ids come from leading `ID:` tokens of acceptance criteria in order | Operator-confirmed in QUESTIONS.md Q1 | decided | n/a |
| 6 | Covered task ids are embedded as a substring in `TriageClassification.reason`, not a new structured field | Operator-confirmed in QUESTIONS.md Q3; DEV-001 (no producer without consumer) supports deferring structure | decided | n/a |
| 7 | `green_verify_unavailable` for an integration lane uses the identical null-exit code path/conditions as GREEN's verify, since the lane's own worktree already represents the merged epic branch | Operator-confirmed in QUESTIONS.md Q4 | decided | n/a |
| 8 | RED prompt surfaces invariant ids as plain substrings in one sentence, not a structured/fenced block | Operator-confirmed in QUESTIONS.md Q5 | decided | n/a |
| 9 | `Lane.kind === 'integration'` is the authoritative runtime signal for the RED-only fast path (rather than `expect_tests_pass` alone) | Design decision to mirror the existing `isStructural` precedent, which branches on `kind`, not a separate boolean; keeps one canonical trigger | decided | n/a |
| 10 | New classifier category is named `code_defect` (or equivalent) distinct from all seven existing `TriageClassifyCategory` values | Ticket R3 explicitly says `agent_behavior` is wrong; no existing category fits "code defect in merged work" per scan of `triage-classify.ts:13-20` | guess | n/a (naming only; low risk, can be renamed in review without spec impact) |

## 9. Classification Metadata

```yaml
estimated_files: 9
estimated_loc: 260
clusters_touched:
  - datum-tdd-act-lane (skills/src/datum-tdd-act-lane.ts + tests)
  - triage-classify (skills/src/shared/triage-classify.ts + tests)
  - shared-types (skills/src/shared/types.ts)
  - lane-plan-digest (datum/lane_plan_digest.py + tests)
  - lane-spec-export (datum/lane_spec_export.py, verification only)
  - docs (docs/FLOW.md, SKILL.md)
new_public_api: false
dependency_additions: []
```
