# SPEC — Integration lanes, slice 2a: an integration lane runs RED-only, end to end

## 1. Summary

Slice 1 gave Plan the ability to schedule `task-INT-<n>` lanes (`kind: "integration"`, `expect_tests_pass: true`) covering a merge frontier, but the lane runner still drives them through the full task-lane state machine (RED, GREEN, skeptic panel, REFACTOR) as if their tests were meant to fail first. This slice changes `runLane` in `skills/src/datum-tdd-act-lane.ts` so an `expect_tests_pass` lane runs RED, the existing post-RED deterministic batch, and one independent test verify, then completes or halts on that verify's exit code alone — never touching reflect, GREEN, the skeptic panel, or REFACTOR. A failing verify halts as `integration_failed`, classified by `skills/src/shared/triage-classify.ts` as a code defect in the merged tasks named in `depends_on`, not as agent misbehavior.

## 2. Context

- `runLane` (`skills/src/datum-tdd-act-lane.ts:193`) is the per-lane TDD state machine. It already special-cases `lane.kind === 'structural'` (`isStructural`, line 218) with a REFACTOR-only fast path that returns before reaching RED/GREEN — this is the direct template for the new `expect_tests_pass` fast path, which instead returns *after* RED instead of skipping RED.
- The existing sequence for a normal lane: intake batch → RED dispatch (`witnessedAgent`) → post-RED deterministic batch (`postRedSteps`, one `datum-cli` batch covering count-gate, placeholder/assert-check scan, test-verify, ownership diff) → scope-repair/contract-preflight → reflect → GREEN → `runSkepticPanel` (line 1428) → `runRefactor` (line 1479).
- `postRedSteps` in `skills/src/shared/lane-steps.ts` already bundles the count-gate / placeholder-scan / ownership checks other requirements call "the post-RED deterministic batch" — this batch runs unchanged for integration lanes; R1 does not touch it.
- GREEN already has an independent, out-of-agent verify with a `{kind: 'passed'|'failed'|'unavailable', exit}`-shaped result (`lane-steps.ts:182-197`, `testExitCode` helper). R2 reuses this exact discriminated-union pattern for the integration lane's independent verify rather than inventing new exit semantics.
- `export_lane_spec` (`datum/lane_spec_export.py:150`) builds its output body as `{schema_version, **lane, task_id, spec_hash, contract_summary}` — the `**lane` spread already forwards `expect_tests_pass` and `depends_on` from the lane dict with zero additional code, and an `INTEGRATION_NOTE` is already prepended to `contract_summary` when `lane.get('kind') == 'integration'`. R4 in this slice is a verification task (confirm an exported `task-INT-<n>` spec actually contains these keys) rather than new plumbing, unless the direct read turns up a gap.
- `classifyLaneError` (`skills/src/shared/triage-classify.ts:244`) dispatches on an ordered `PREFIX_RULES` list of `{test: RegExp, category, reason}`. No rule exists yet for `integration_failed`. `TriageClassification` today is `{category, confidence, reason}` with no structured field for task ids — R3 needs the covered task ids extracted from the `error` string (since R2's error format already embeds them) into `reason`, since adding a new field is out of scope for a minimal, additive change unless testing requires otherwise.
- `docs/FLOW.md:126` currently says an integration lane "still runs the full RED → GREEN → skeptic → REFACTOR path" and calls RED-only execution "slice 2" work — this sentence and the §5 ledger entry for the closed slice-1 epic need updating per R5. `SKILL.md:141` currently says `integration_failed` is "reserved" — R5 changes this to a live, documented failure name.
- `plan_not_sliced` (referenced in the ticket's Constraints) is pre-existing, already shipped on `main` in commit `92f2dd8a` — it is not new work in this slice; it is a gate this epic's own Plan phase must satisfy (R6).

## 3. Requirements

### R1 — `runLane` runs an `expect_tests_pass` lane RED-only

The lane runner reads `expect_tests_pass` off the lane object (sourced from the hash-verified lane-spec file, same as every other per-lane field). When true:
- RED dispatches exactly once, with a prompt stating the tests must pass (because the code under test is already merged) and naming the invariant ids the lane's acceptance criteria cover.
- The post-RED deterministic batch (`postRedSteps`: count-gate, placeholder/assert-check scan, ownership diff) runs exactly once, unchanged from the task-lane path.
- The independent test-verify step required by R2 runs exactly once.
- Reflect, GREEN, `runSkepticPanel`, and `runRefactor` are never invoked.

**Acceptance criteria:**
- AC1.1: A vitest test drives `runLane` with a fake/mocked agent through a lane with `expect_tests_pass: true` and asserts the RED agent call happened exactly once.
- AC1.2: The same test asserts zero calls into reflect, GREEN, `runSkepticPanel`, and `runRefactor`.
- AC1.3: The same test asserts the post-RED deterministic batch (`postRedSteps`) ran exactly once.
- AC1.4: The RED prompt text passed to the fake agent contains language indicating tests must pass and lists the invariant ids drawn from the lane's acceptance criteria.

### R2 — the independent verify decides the lane outcome

An independent test-verify batch (reusing the `{kind: 'passed'|'failed'|'unavailable', exit}` pattern from GREEN's existing verify) runs after the post-RED batch, once, for every `expect_tests_pass` lane.
- Exit 0 (`kind: 'passed'`): the lane's `LaneOutcome` is `completed` at `stage: 'RED'`; `follow_ups` is left unchanged from whatever RED produced.
- Non-zero exit (`kind: 'failed'`): the lane fails with `error` starting with the literal prefix `integration_failed:`, followed by the covered task ids (from `lane.depends_on`) and the invariant ids from the lane's acceptance criteria, e.g. `integration_failed: covered task-002, task-003; invariants INV-01, INV-03`.
- Null exit (`kind: 'unavailable'`, verify did not run — e.g. the verify command itself could not be invoked): the lane fails with `error` of `green_verify_unavailable`, identical to the existing task-lane behavior for an unavailable GREEN verify. This is never treated as a pass.

**Acceptance criteria:**
- AC2.1: A vitest test with a fake verify batch returning exit 0 asserts `LaneOutcome.status === 'completed'`, `LaneOutcome.stage === 'RED'`, and `follow_ups` unchanged from the RED result.
- AC2.2: A vitest test with a fake verify batch returning exit 1 asserts `LaneOutcome.error` starts with `integration_failed:` and contains every id in `lane.depends_on` and every invariant id from the lane's acceptance criteria.
- AC2.3: A vitest test with a fake verify batch returning a null exit asserts `LaneOutcome.error === 'green_verify_unavailable'` and `status !== 'completed'`.
- AC2.4: The verify batch is confirmed to run inside the existing `postRedSteps`/batch mechanism (or one additional call at most) — no new `datum-cli` command-runner invocation is added beyond what R1's constraint allows.

### R3 — `classifyLaneError` treats `integration_failed` as a code defect naming the covered tasks

A new `PrefixRule` (ordered ahead of any less-specific catch-all) matches the `integration_failed:` prefix and returns a `TriageClassification` with `category: 'code_defect'` (or the codebase's existing equivalent category value — not `agent_behavior`), and a `reason` string that carries the covered task ids extracted from the error text.

**Acceptance criteria:**
- AC3.1: A vitest/jest test calls `classifyLaneError('integration_failed: covered task-002, task-003; invariants INV-01', 'RED')` and asserts `category` is the code-defect category (never `agent_behavior`).
- AC3.2: The same test asserts `reason` contains `task-002` and `task-003`.
- AC3.3: A test confirms `integration_failed:` is matched before any more general prefix rule that would otherwise shadow it (ordering regression guard).

### R4 — `datum lane-spec-export` carries `expect_tests_pass` and covered task ids

The exported lane-spec file for a `task-INT-<n>` lane includes `expect_tests_pass` and the covered task ids (`depends_on`) as top-level keys, sourced from the same hash-verified file every other per-stage read uses — no separate, second source of truth.

**Acceptance criteria:**
- AC4.1: A pytest test exports a lane spec for a lane dict containing `kind: 'integration'`, `expect_tests_pass: True`, `depends_on: ['task-002', 'task-003']` and asserts the exported JSON body contains `expect_tests_pass: true` and `depends_on: ['task-002', 'task-003']`.
- AC4.2: A pytest test asserts the exported spec's hash changes if `expect_tests_pass` or `depends_on` changes (i.e., these fields are part of what gets hash-verified, not appended out-of-band after hashing).

### R5 — docs describe the RED-only path and retire the "reserved" language

- `docs/FLOW.md` §3 gains one paragraph describing the integration lane path (RED → post-RED batch → independent verify → complete/halt) beside the existing task lane paragraph, replacing the sentence that currently says the full RED→GREEN→skeptic→REFACTOR path still runs.
- `docs/FLOW.md` §5's slice-1 ledger entry is updated (not replaced) to record that RED-only execution has shipped.
- `SKILL.md`'s line describing `integration_failed` changes from "reserved" to a documented, live failure name alongside the other lane failure names.

**Acceptance criteria:**
- AC5.1: `docs/FLOW.md` §3 contains a paragraph mentioning `expect_tests_pass`, RED-only execution, and `integration_failed` immediately beside the task-lane description.
- AC5.2: `docs/FLOW.md` §5's slice-1 ledger entry text no longer states integration lanes run the full task-lane path; it states RED-only execution shipped, dated to this slice.
- AC5.3: `SKILL.md` no longer describes `integration_failed` as "reserved"; it lists it among the live failure names with a one-line description matching R2's semantics.

### R6 — this epic's own Act run proves the path end to end

This epic's own Properties phase derives at least one integration invariant across its tasks; Plan schedules at least one `task-INT-<n>` lane covering those tasks; Act runs that lane RED-only and it completes (or halts as `integration_failed`, which is also a valid, informative outcome — but a green run is the expected steady state once the merged code is correct).

**Acceptance criteria:**
- AC6.1: This epic's `PROPERTIES.md` contains an `## Integration Invariants` table with at least one row.
- AC6.2: This epic's `TASKS.md`/lane plan contains at least one `task-INT-<n>` lane with `kind: 'integration'` and non-empty `depends_on`.
- AC6.3: This epic's Act log shows the `task-INT-<n>` lane's RED stage dispatched exactly once with no GREEN/skeptic/REFACTOR entries, and a final outcome of `completed` at stage RED, or an `integration_failed` halt — never a silent `green_verify_unavailable` treated as a pass.
- AC6.4: If Plan produces no integration lane for this epic, that is logged and treated as a defect of this slice's Plan-phase integration (per the ticket's explicit instruction), not a passing run.

## 4. Failure Modes

| Failure | Handling |
|---|---|
| Independent verify exits non-zero (merged code actually broke an invariant) | Lane fails with `error` starting `integration_failed:`, listing covered task ids and invariant ids. Classified as `code_defect` (or equivalent), never `agent_behavior`. |
| Independent verify cannot run at all (verify command missing/misconfigured, timeout invoking it) | Lane fails with `error === 'green_verify_unavailable'`. Never treated as a pass, per R2. |
| RED agent produces a passing-tests lane but omits invariant ids from the prompt/response | Test coverage in AC1.4 catches missing invariant ids in the prompt; a lane-spec missing `depends_on`/invariant data should fail lane-spec validation before RED ever dispatches. |
| `expect_tests_pass` lane accidentally falls through to reflect/GREEN due to a missed early-return | AC1.2 explicitly asserts zero calls into reflect/GREEN/skeptic/REFACTOR — a regression here fails the test suite immediately. |
| `integration_failed:` error string shape drifts from what `classifyLaneError`'s regex expects | AC3.3 pins prefix-rule ordering and exact-match behavior; any format change requires updating both the lane runner's error-string builder and the classifier's regex in the same commit. |
| Plan does not produce an integration lane for this epic | Treated as a defect per AC6.4 — the run does not silently report success; the workflow must surface this as a failure of this slice, not a no-op. |
| `depends_on` on an integration lane is empty or missing | `integration_failed:` message would have nothing to list; lane-spec export/validation should reject an integration lane with empty `depends_on` before Act begins (defensive check, not a new phase). |

## 5. Non-Functional Requirements

| Requirement | Target |
|---|---|
| No new command-runner call per lane | The independent verify for R2 reuses or extends the existing batch mechanism (`postRedSteps` or one bundled follow-on call) — zero additional `datum-cli` process spawns beyond what task lanes already incur, per the ticket's Constraints. |
| Generated bundle discipline | All lane-runner/classifier/export changes land in `skills/src/**` and `datum/*.py` source files only; `skills/*.js` bundles are regenerated via `bash scripts/build-workflows.sh`, never hand-edited. |
| Backward compatibility | Lanes without `expect_tests_pass` (or with it `false`/absent) are entirely unaffected — the existing task-lane RED→GREEN→skeptic→REFACTOR path and its existing tests must continue to pass unmodified. |
| Determinism | The RED-only vs. full-path branch is a pure function of lane-spec data (`kind`, `expect_tests_pass`) read once at lane start — no runtime heuristic or agent self-report decides the branch. |
| Test isolation | New vitest tests for `runLane`'s integration-lane branch use the existing fake-agent/mocked-batch harness pattern already used by `datum-tdd-act-lane.calls.test.ts`, not real subprocess calls. |

## 6. Out of Scope

- The prove-it-can-fail mutation check (`integration_test_vacuous`) — deferred to slice 2b.
- Turning the `plan_not_sliced` warning into a hard halt — deferred to slice 2c.
- Any change to `plan_not_sliced` itself; it is pre-existing (commit `92f2dd8a`) and only consumed, not modified, by this slice.
- Any change to how Properties derives integration invariants or how Plan schedules `task-INT-<n>` lanes structurally — that shipped in slice 1; this slice only changes what Act does with the lane once scheduled.
- Adding a new field to `TriageClassification` for structured task-id carriage, unless a test in R3 proves string-embedding in `reason` is insufficient — the default approach is string-embedding to minimize blast radius.

## 7. Open Questions

See `QUESTIONS.md` for the full list. Key items that block precise implementation until answered:
- Exact wording/delimiter format of the `integration_failed:` error string (comma-separated ids vs. bracketed list) — R2/R3's ACs above assume a human-readable, substring-matchable format but the precise separator is not yet fixed.
- Whether the independent verify for integration lanes is a wholly new batch call or an extension of `postRedSteps`'s existing single batch, given the "no new command-runner call" constraint.
- Whether `TriageClassification` needs a new structured field for task ids or string-embedding in `reason` is sufficient for downstream consumers (e.g. GitHub issue filing in `datum-tdd-act-triage`).

## 8. Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | `expect_tests_pass` is read directly off the lane object at the top of `runLane`, mirroring the existing `isStructural` pattern at line 218 | Confirmed pattern exists in codebase scan; most consistent with "no new command-runner call" constraint | confirmed | n/a |
| 2 | The independent verify reuses GREEN's existing `{kind: 'passed'|'failed'|'unavailable'}` result shape from `lane-steps.ts:182-197` rather than a new type | Scan explicitly identifies this as "the exact existing pattern R2 says to reuse" | decided | n/a |
| 3 | `export_lane_spec`'s `**lane` spread already satisfies R4 with no code change | Scan confirms `**lane` spread and existing `INTEGRATION_NOTE` logic in `lane_spec_export.py:150,172-173`; R4 becomes a verification/regression-test task | confirmed | n/a |
| 4 | `integration_failed:` is matched via string-embedding of task/invariant ids in the `reason` field of `TriageClassification`, not a new struct field | Minimal-diff default per DEV/AI-003 "no drive-by rewrites"; TriageClassification has no id-carrying field today | guess | Q (verify format) |
| 5 | The invariant ids referenced in the RED prompt and in `integration_failed:` come from the lane's acceptance criteria / `## Integration Invariants` table produced in slice 1's Properties phase | Ticket's Why section and scan's Properties/Plan context | decided | n/a |
| 6 | `plan_not_sliced` is pre-existing and out of scope to modify in this slice | Confirmed via scan: "Already shipped on this branch (commit 92f2dd8a)" | confirmed | n/a |
| 7 | The exact separator/format for listing covered task ids and invariant ids in the `integration_failed:` string (e.g., `covered task-002, task-003; invariants INV-01`) is illustrative, not yet fixed by any existing code or prior convention | No existing `integration_failed` usage in codebase to pattern-match against | guess | Q (format) |
| 8 | The independent verify step can be added as one additional step inside `postRedSteps`'s existing batch call rather than a wholly separate `runBatch` invocation | Constraint says "no new command runner call per lane beyond the existing batches" — ambiguous whether "batches" (plural) permits one more batch or means literally the same batch | guess | Q (mechanism) |

## 9. Classification Metadata

```yaml
estimated_files: 9
estimated_loc: 260
clusters_touched:
  - skills/src/datum-tdd-act-lane.ts
  - skills/src/datum-tdd-act-lane.calls.test.ts
  - skills/src/datum-tdd-act-lane.test.ts
  - skills/src/shared/lane-steps.ts
  - skills/src/shared/triage-classify.ts
  - skills/src/shared/triage-classify.test.ts
  - datum/lane_spec_export.py
  - tests/test_lane_spec_export.py
  - docs/FLOW.md
  - SKILL.md
new_public_api: false
dependency_additions: []
```
