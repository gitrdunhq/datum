# PROPERTIES — Integration lanes, slice 2a: an integration lane runs RED-only, end to end

Derived from SPEC.md (R1-R6) and TASKS.md (task-001..task-004). Categories per the standard 11.

## 1. Properties by Category

### SAFETY — what must never happen

- PROPERTY(SAFETY-001): An integration lane (`kind === 'integration'`) never dispatches a GREEN call, `runSkepticPanel`, or `runRefactor` — the call log contains zero labels for those stages regardless of the `test-verify` outcome.
- PROPERTY(SAFETY-002): A null/absent `test-verify` exit code is never mapped to `status === 'completed'` — the "never a pass on unavailable verify" invariant holds for every code path that reads `testExitCode`/`verifyVerdict`.
- PROPERTY(SAFETY-003): The integration-lane fast path never issues a second `runBatch`/command-runner call beyond the single `postRedSteps` batch — no lane produces two `datum-cli` invocations.
- PROPERTY(SAFETY-004): Adding `'integration'` to `Lane.kind` and `expect_tests_pass` to `Lane` never changes the behavior of a `kind: 'structural'` or `kind: 'behavioral'` lane (fields are additive/optional; existing fast paths are untouched).
- PROPERTY(SAFETY-005): Inserting the `code_defect` `PREFIX_RULES` entry never reorders or reclassifies any pre-existing prefix (`lane_intake_failed`, `green_verify_unavailable`, `count_gate_failed`, `refactor_failed`, existing `agent_behavior` prefixes) — every existing classify() call keeps its prior category.
- PROPERTY(SAFETY-006): task-004 (docs-only) never modifies a source file — the diff touches only `docs/FLOW.md` and `SKILL.md`.

### LIVENESS — what must eventually happen

- PROPERTY(LIVENESS-001): For a `kind: 'integration'` lane, RED is eventually dispatched exactly once and the lane eventually reaches a terminal `status` (`completed` or `failed`) — the runner never hangs waiting on GREEN/skeptic/REFACTOR dispatch for this lane kind.
- PROPERTY(LIVENESS-002): Given `test-verify` exit `0`, the lane eventually reaches `{status: 'completed', stage: 'RED'}`.
- PROPERTY(LIVENESS-003): Given `test-verify` exit non-zero, the lane eventually reaches `{status: 'failed', error: 'integration_failed: ...'}` rather than retrying indefinitely.
- PROPERTY(LIVENESS-004): Given the `test-verify` step is absent/refused, the lane eventually reaches a terminal `failed` state with a `green_verify_unavailable:`-prefixed error rather than blocking.
- PROPERTY(LIVENESS-005): This epic's own Act run eventually produces at least one `task-INT-<n>` lane that reaches stage `RED` with a terminal status (AC6.3) — a plan with zero integration lanes for this epic is a defect, not a silent pass (AC6.4).
- PROPERTY(LIVENESS-006): An `integration_failed:` classification is eventually resolvable to a non-`agent_behavior` category with a populated `reason`, so downstream issue-filing/halt-message consumers are never left with an `unknown`/default fallback for this error family.

### INVARIANT — what must always be true

- PROPERTY(INVARIANT-001): `_LANE_FIELDS` always contains `'expect_tests_pass'`, `'depends_on'`, and `'kind'` simultaneously (no field is dropped when another is added).
- PROPERTY(INVARIANT-002): For any lane dict with `expect_tests_pass` present (`True` or `False`) and not `None`, the digest entry's `expect_tests_pass` key equals the input value exactly (round-trips, including `False`).
- PROPERTY(INVARIANT-003): For any lane dict without an `expect_tests_pass` key, the digest entry never contains an `expect_tests_pass` key (absent stays absent; the existing `if field in lane and lane[field] is not None` guard is preserved, not replaced by a `setdefault`).
- PROPERTY(INVARIANT-004): `TriageClassifyCategory` always has exactly eight members after this slice (seven pre-existing plus `code_defect`), and `DESTINATION_BY_CATEGORY` plus both `datum-tdd-act-triage.ts` label maps are always total functions over that set (the exhaustiveness check always type-checks).
- PROPERTY(INVARIANT-005): The RED prompt for an `expect_tests_pass` lane always contains, verbatim, the substring `This lane covers invariants: ` followed by the ordered `ID:`-token list, and always contains the sentence `The code under test is already merged: these tests must PASS on your first run; a failing test is a finding, report it, do not weaken it.`
- PROPERTY(INVARIANT-006): `kind === 'integration'` is always treated as authoritative for the RED-only fast path even when `expect_tests_pass` is missing/false on the same lane (a warning is logged, but the fast path is always taken).
- PROPERTY(INVARIANT-007): The `integration_failed:` error string always matches the exact grammar `integration_failed: covered <task-ids joined ", ">; invariants <invariant-ids joined ", "> (independent verify exit=<n>)` with task ids in `depends_on` order and invariant ids in acceptance-criteria order.

### BOUNDARY — valid input ranges

- PROPERTY(BOUNDARY-001): `depends_on` with exactly one task id produces a task-id segment with no separator (`covered task-002`, no trailing/leading comma).
- PROPERTY(BOUNDARY-002): An acceptance-criteria list with a single `ID:` token produces a single invariant id in the `invariants` segment (no comma).
- PROPERTY(BOUNDARY-003): An `integration_failed:` error string with no `covered ` segment at all still classifies as `code_defect` without throwing (regex-miss is handled, not fatal).
- PROPERTY(BOUNDARY-004): `test-verify` exit code boundary values (`0` exactly vs. any non-zero, including negative/signal-derived codes) are classified correctly: only exactly `0` is a pass; every other numeric value (`1`, `2`, `127`, etc.) is `integration_failed`; `null`/`undefined`/missing is `green_verify_unavailable`, a distinct third state, never collapsed into either boundary.
- PROPERTY(BOUNDARY-005): An empty or missing acceptance-criteria list on an integration lane produces an empty (not crashing) invariant-id segment in both the RED prompt and the `integration_failed:` string.

### IDEMPOTENT — what is safe to run twice

- PROPERTY(IDEMPOTENT-001): Running `postRedSteps` with the same `verifyTestCmd` twice against the same merged worktree state produces the same `test-verify` exit code and therefore the same lane outcome (no hidden mutation of the already-merged code under test by the verify step itself).
- PROPERTY(IDEMPOTENT-002): Re-running `datum lane-spec-export` for the same integration lane twice produces byte-identical `expect_tests_pass`/`depends_on` fields in the written spec (deterministic spread of the same lane dict).
- PROPERTY(IDEMPOTENT-003): Calling `classifyLaneError` twice on the same `integration_failed:` string yields the same category and the same `reason` substring extraction both times (pure function, no state carried between calls).

### ORDERING — order invariants

- PROPERTY(ORDERING-001): Within `runLane` for an integration lane, RED always completes before `postRedSteps` (with `verifyTestCmd`) is invoked; `postRedSteps` always completes before the lane outcome is decided from `test-verify`'s exit code.
- PROPERTY(ORDERING-002): Task ids in the `integration_failed:` string preserve `depends_on` array order exactly (not sorted, not deduplicated-and-reordered).
- PROPERTY(ORDERING-003): Invariant ids in the `integration_failed:` string and in the RED prompt preserve the order of the `ID:` tokens as they appear in the lane's acceptance criteria (not sorted).
- PROPERTY(ORDERING-004): task-003 (classifier) is scheduled after task-002 (lane runner) in the dependency graph, because task-003's tests assert against the byte-exact string task-002 produces — task-003 must never run its RED phase against a paraphrased or guessed string.
- PROPERTY(ORDERING-005): `PREFIX_RULES`' new `code_defect` entry is appended without moving any existing entry's position relative to the others (append-only insertion, verified by unchanged classification of every pre-existing prefix).

### ISOLATION — what cannot leak between contexts

- PROPERTY(ISOLATION-001): The invariant-id/task-id substitution for one lane's RED prompt and `integration_failed:` string never leaks into another lane's prompt or error string in the same Act run (each lane's `depends_on`/acceptance-criteria are scoped to that lane's own spec).
- PROPERTY(ISOLATION-002): A `code_defect` classification's `reason` never includes task ids from an unrelated error string (the `covered ([^;]+)` extraction is scoped to the single error string passed to `classifyLaneError`, not to any global/shared state).
- PROPERTY(ISOLATION-003): The digest entry for one lane's `expect_tests_pass`/`kind`/`depends_on` never contaminates another lane's digest entry when multiple lanes are digested from the same plan (`_LANE_FIELDS` iteration is per-lane).
- PROPERTY(ISOLATION-004): An integration lane's independent verify runs in that lane's own worktree only — it never reads or mutates a sibling lane's worktree or the root epic worktree state.

### PERFORMANCE — latency/throughput/size bounds

- PROPERTY(PERFORMANCE-001): The integration-lane fast path issues at most one command-runner (`datum-cli`) batch call per lane — strictly fewer round trips than a task lane (which issues additional batches for GREEN/skeptic/REFACTOR), never more.
- PROPERTY(PERFORMANCE-002): Skipping GREEN dispatch, `runSkepticPanel`, and `runRefactor` for an integration lane strictly reduces wall-clock agent-call count for that lane relative to the pre-slice behavior (task-lane treatment of the same lane).
- PROPERTY(PERFORMANCE-003): The `expect_tests_pass`/`kind` fields added to `_LANE_FIELDS` and `Lane` add O(1) additional bytes per lane to the digest and spec file — no unbounded growth (e.g. no accidental full-object embedding).

### SECURITY — access controls

- PROPERTY(SECURITY-001): The RED agent and the TS runner obtain `expect_tests_pass`/`depends_on` only from the hash-verified lane-spec file or the in-memory digest built from the plan file — never from an LLM-relayed printed summary line, preventing a prompt-injected or hallucinated flag from flipping lane treatment.
- PROPERTY(SECURITY-002): A lane cannot force itself into the RED-only fast path by claiming `expect_tests_pass: true` alone while `kind !== 'integration'` — `kind` is the authoritative, plan-derived (not agent-supplied) signal, so an agent's own output cannot self-elevate a task lane into skipping GREEN/skeptic/REFACTOR.
- PROPERTY(SECURITY-003): The `covered ([^;]+)` regex extraction in the classifier only ever reads from the runner-constructed `integration_failed:` string, never from unsanitized agent-authored free text, bounding what can appear in a filed GitHub issue's `reason`.

### OBSERVABILITY — what must be logged or measured

- PROPERTY(OBSERVABILITY-001): When `kind === 'integration'` but `expect_tests_pass` is missing/false (data drift), a warning is logged naming the disagreement before the fast path proceeds.
- PROPERTY(OBSERVABILITY-002): Every terminal outcome of an integration lane (`completed`/`RED`, `integration_failed:`, `green_verify_unavailable:`) is observable in the Act log/lane result with enough detail (stage, status, error prefix) to distinguish the three cases without re-running the lane.
- PROPERTY(OBSERVABILITY-003): A `code_defect` classification is observable as distinct from `agent_behavior` in any triage report or filed GitHub issue, with `reason` naming the covered task ids.
- PROPERTY(OBSERVABILITY-004): This epic's own `PROPERTIES.md`/`lane-plan.json`/Act log (R6/AC6.1-AC6.3) make the presence of at least one integration lane and its terminal outcome directly observable to a human reviewing the run, without needing to re-derive it from source.

### COMPATIBILITY — existing behavior that must be preserved

- PROPERTY(COMPATIBILITY-001): The `isStructural` fast path (`kind === 'structural'` → straight to `runRefactor`) is unchanged in behavior and code path after this slice's edits.
- PROPERTY(COMPATIBILITY-002): A `kind: 'behavioral'` (or absent-`kind`) lane still runs the full RED → GREEN → skeptic → REFACTOR sequence unchanged.
- PROPERTY(COMPATIBILITY-003): All seven pre-existing `TriageClassifyCategory` values, their `DESTINATION_BY_CATEGORY` mappings, and both `datum-tdd-act-triage.ts` label maps keep their exact prior mapping after `code_defect` is added.
- PROPERTY(COMPATIBILITY-004): Every pre-existing `PREFIX_RULES` test case (`lane_intake_failed`, `green_verify_unavailable`, `count_gate_failed`, `refactor_failed`, existing `agent_behavior` prefixes) continues to pass unchanged (AC3.2).
- PROPERTY(COMPATIBILITY-005): A lane dict without `expect_tests_pass` continues to produce a digest entry with no such key, exactly as today's `if field in lane and lane[field] is not None` loop already behaves for every other optional field.
- PROPERTY(COMPATIBILITY-006): `postRedSteps`'s existing count-gate/placeholder-scan/ownership-diff steps run identically for an integration lane as for a task lane (only the added `verifyTestCmd` argument is new).

## 2. Traceability Table

| Property ID | Category | Predicate | Task IDs |
|---|---|---|---|
| SAFETY-001 | SAFETY | Zero GREEN/skeptic/REFACTOR calls for an integration lane | task-002 |
| SAFETY-002 | SAFETY | Null verify exit never yields `completed` | task-002 |
| SAFETY-003 | SAFETY | No second `runBatch` call for an integration lane | task-002 |
| SAFETY-004 | SAFETY | Widened `Lane.kind`/`expect_tests_pass` doesn't affect structural/behavioral lanes | task-002 |
| SAFETY-005 | SAFETY | New `code_defect` rule doesn't reorder/reclassify existing prefixes | task-003 |
| SAFETY-006 | SAFETY | Docs task touches only docs/FLOW.md and SKILL.md | task-004 |
| LIVENESS-001 | LIVENESS | Integration lane RED dispatched once, reaches terminal status | task-002 |
| LIVENESS-002 | LIVENESS | Verify exit 0 → completed@RED | task-002 |
| LIVENESS-003 | LIVENESS | Verify exit non-zero → failed/integration_failed | task-002 |
| LIVENESS-004 | LIVENESS | Verify absent → failed/green_verify_unavailable | task-002 |
| LIVENESS-005 | LIVENESS | This epic's Act produces ≥1 terminal task-INT lane | task-002, task-003 |
| LIVENESS-006 | LIVENESS | integration_failed always resolves to a populated non-agent_behavior classification | task-003 |
| INVARIANT-001 | INVARIANT | `_LANE_FIELDS` always contains expect_tests_pass, depends_on, kind together | task-001 |
| INVARIANT-002 | INVARIANT | expect_tests_pass value round-trips (incl. False) | task-001 |
| INVARIANT-003 | INVARIANT | Absent expect_tests_pass stays absent in digest | task-001 |
| INVARIANT-004 | INVARIANT | TriageClassifyCategory always has 8 total, exhaustive maps | task-003 |
| INVARIANT-005 | INVARIANT | RED prompt always contains invariant-id sentence and must-PASS sentence | task-002 |
| INVARIANT-006 | INVARIANT | kind is authoritative over expect_tests_pass disagreement | task-002 |
| INVARIANT-007 | INVARIANT | integration_failed string always matches exact grammar | task-002, task-003 |
| BOUNDARY-001 | BOUNDARY | Single-task depends_on has no separator | task-002 |
| BOUNDARY-002 | BOUNDARY | Single invariant id has no comma | task-002 |
| BOUNDARY-003 | BOUNDARY | No `covered ` segment still classifies without throwing | task-003 |
| BOUNDARY-004 | BOUNDARY | Exit-code boundary: 0 vs non-zero vs null are 3 distinct outcomes | task-002 |
| BOUNDARY-005 | BOUNDARY | Empty acceptance-criteria list doesn't crash prompt/string building | task-002 |
| IDEMPOTENT-001 | IDEMPOTENT | Re-running verify against same worktree yields same outcome | task-002 |
| IDEMPOTENT-002 | IDEMPOTENT | Re-running lane-spec-export is byte-identical | task-001 |
| IDEMPOTENT-003 | IDEMPOTENT | classifyLaneError is a pure, repeatable function | task-003 |
| ORDERING-001 | ORDERING | RED before postRedSteps before outcome decision | task-002 |
| ORDERING-002 | ORDERING | Task ids preserve depends_on order | task-002 |
| ORDERING-003 | ORDERING | Invariant ids preserve acceptance-criteria order | task-002 |
| ORDERING-004 | ORDERING | task-003 scheduled after task-002 (dependency) | task-002, task-003 |
| ORDERING-005 | ORDERING | code_defect rule appended, not reordered | task-003 |
| ISOLATION-001 | ISOLATION | Per-lane id substitution doesn't leak across lanes | task-002 |
| ISOLATION-002 | ISOLATION | classify() reason scoped to single input string | task-003 |
| ISOLATION-003 | ISOLATION | Digest entries don't contaminate across lanes | task-001 |
| ISOLATION-004 | ISOLATION | Verify runs only in the lane's own worktree | task-002 |
| PERFORMANCE-001 | PERFORMANCE | At most one datum-cli batch call per integration lane | task-002 |
| PERFORMANCE-002 | PERFORMANCE | Fewer agent calls than task-lane treatment of same lane | task-002 |
| PERFORMANCE-003 | PERFORMANCE | Added fields are O(1) size, no unbounded growth | task-001, task-002 |
| SECURITY-001 | SECURITY | Runner/RED read flags from hash-verified file/digest, not printed summary | task-001, task-002 |
| SECURITY-002 | SECURITY | kind (plan-derived), not agent-supplied expect_tests_pass alone, is authoritative | task-002 |
| SECURITY-003 | SECURITY | Classifier regex reads only runner-constructed string | task-003 |
| OBSERVABILITY-001 | OBSERVABILITY | Warning logged on kind/expect_tests_pass disagreement | task-002 |
| OBSERVABILITY-002 | OBSERVABILITY | All three terminal outcomes distinguishable in Act log | task-002 |
| OBSERVABILITY-003 | OBSERVABILITY | code_defect distinct from agent_behavior in triage/issue output | task-003 |
| OBSERVABILITY-004 | OBSERVABILITY | This epic's own artifacts make integration lane outcome observable | task-002, task-003 |
| COMPATIBILITY-001 | COMPATIBILITY | isStructural fast path unchanged | task-002 |
| COMPATIBILITY-002 | COMPATIBILITY | behavioral lane flow unchanged | task-002 |
| COMPATIBILITY-003 | COMPATIBILITY | Seven pre-existing categories keep their mappings | task-003 |
| COMPATIBILITY-004 | COMPATIBILITY | Pre-existing PREFIX_RULES tests keep passing | task-003 |
| COMPATIBILITY-005 | COMPATIBILITY | Lane without expect_tests_pass unaffected in digest | task-001 |
| COMPATIBILITY-006 | COMPATIBILITY | postRedSteps' existing steps run identically, only verifyTestCmd is new | task-002 |

## 3. Per-Task Property Assignments

### task-001 — Lane digest and exported lane spec carry expect_tests_pass for integration lanes
INVARIANT-001, INVARIANT-002, INVARIANT-003, IDEMPOTENT-002, ISOLATION-003, PERFORMANCE-003, SECURITY-001, COMPATIBILITY-005

### task-002 — runLane executes an integration lane RED-only and decides it on the independent verify
SAFETY-001, SAFETY-002, SAFETY-003, SAFETY-004, LIVENESS-001, LIVENESS-002, LIVENESS-003, LIVENESS-004, LIVENESS-005, INVARIANT-005, INVARIANT-006, INVARIANT-007, BOUNDARY-001, BOUNDARY-002, BOUNDARY-004, BOUNDARY-005, IDEMPOTENT-001, ORDERING-001, ORDERING-002, ORDERING-003, ORDERING-004, ISOLATION-001, ISOLATION-004, PERFORMANCE-001, PERFORMANCE-002, PERFORMANCE-003, SECURITY-001, SECURITY-002, OBSERVABILITY-001, OBSERVABILITY-002, OBSERVABILITY-004, COMPATIBILITY-001, COMPATIBILITY-002, COMPATIBILITY-006

### task-003 — Triage classifies integration_failed as a code defect naming the covered tasks
SAFETY-005, LIVENESS-005, LIVENESS-006, INVARIANT-004, INVARIANT-007, BOUNDARY-003, IDEMPOTENT-003, ORDERING-004, ORDERING-005, ISOLATION-002, SECURITY-003, OBSERVABILITY-003, OBSERVABILITY-004, COMPATIBILITY-003, COMPATIBILITY-004

### task-004 — Document the integration-lane runtime path in FLOW.md and mark integration_failed live in SKILL.md
SAFETY-006

Note: task-004 is docs-only (structural, single-stage commit, no RED/GREEN per TASKS.md). Its acceptance criteria are review-checkable prose statements, deliberately not phrased as test assertions (a grep-for-a-word test would be worthless per TDD-002). SAFETY-006 is the one property with a directly testable predicate (diff scope); the remaining ACs for task-004 are verified by human/reviewer inspection against SPEC R5, consistent with the task's own RED Note.

## Integration Invariants

| ID | Invariant | Covers | Source |
|---|---|---|---|
| INT-01 | The `integration_failed:` error string produced by the lane runner (task-002) and the `covered ([^;]+)` extraction regex in the classifier (task-003) agree byte-for-byte on format, so a classify() call against the runner's real output always yields a `reason` containing every covered task id | task-002, task-003 | spec:R2 |
| INT-02 | `expect_tests_pass` and `depends_on` written by `lane_plan_digest.py`/`lane_spec_export.py` (task-001) are the exact fields `runLane` (task-002) reads to decide the RED-only fast path and to build the RED prompt and error string, with no re-derivation or renaming across the language boundary | task-001, task-002 | spec:R4 |
| INT-03 | This epic's own Properties/Plan/Act run (spanning task-001 through task-003's shipped code) must produce at least one `task-INT-<n>` lane that reaches a terminal RED-stage outcome, or the epic's own run is a slice defect, not a pass | task-002, task-003 | spec:R6 |
| INT-04 | The `integration_failed:` error string is human-readable, two parts, semicolon-delimited, comma-separated ids, exactly `integration_failed: covered task-002, task-003; invariants INV-01, INV-03 (independent verify exit=1)`, with task ids from `depends_on` order and invariant ids from acceptance-criteria `ID:` order, and the classifier extracts task ids with exactly one regex on `covered ([^;]+)` and nothing else parses the string | task-002, task-003 | question:Q1 |
| INT-05 | The independent test verify for an integration lane runs as one additional step folded into the existing `postRedSteps` batch call (via its `verifyTestCmd` parameter), never as a second `runBatch` invocation, and the verdict is read with the existing `testExitCode` helper on that step | task-002 | question:Q2 |
| INT-06 | Covered task ids are embedded as a substring of `TriageClassification.reason` (extracted via regex), not carried on a new structured `taskIds: string[]` field, sufficient for the issue-filer and halt message that both read `reason` in this slice | task-003 | question:Q3 |
| INT-07 | The independent verify's null-exit ("unavailable") conditions for an integration lane are identical to GREEN's existing verify conditions and code path — no new "merge branch not built" case exists, because an integration lane's own worktree already represents the merged epic branch at intake | task-002 | question:Q4 |
| INT-08 | The RED prompt for an `expect_tests_pass` lane surfaces invariant ids as plain substrings in one sentence (`This lane covers invariants: INV-01, INV-03.`) followed by the must-PASS sentence, with no fenced/structured block, and the test asserts via `contains()` on the id strings and on "must PASS" | task-002 | question:Q5 |
| INT-09 | Plan makes the final task cut with the sole rule "no single-layer task"; task-001 crosses digest+export (Python producer layer only per its own scope) while task-002 crosses runner+types+prompt (R1, R2, R4.2) and task-003 crosses classifier+destination-map+label-map (R3) — each of task-002 and task-003 individually spans multiple layers, and R6 is verified by this epic's own Act run rather than as a separate task | task-001, task-002, task-003 | question:Q6 |
| INT-10 | Neither Refine nor Plan hand-verifies that this epic's own Properties/Plan produced an Integration Invariants table or an INT-lane; `datum gate properties` fails without the table and `datum gate plan` warns `no_integration_invariants` when no INT lane is scheduled, making a missing lane visible at the plan gate before Act runs, and a warning here on this epic counts as the slice's first defect | task-002, task-003 | question:Q7 |
| INT-11 | The R1/R2 vitest test for task-002 uses the fake-agent/mocked-batch-response pattern already established in `datum-tdd-act-lane.calls.test.ts` (canned `TEST_EXIT=0`/`TEST_EXIT=1` batch replies), with no real git worktree or actually-merged commits required — the real merged-branch case is verified separately by this epic's own Act run (R6) | task-002 | question:Q8 |
