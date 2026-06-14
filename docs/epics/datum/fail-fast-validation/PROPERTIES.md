# PROPERTIES — Fail-Fast Deterministic Validation Before Tests

Derived from SPEC `docs/epics/datum/fail-fast-validation/SPEC.md`.  
Each property is a testable predicate. The traceability table at the end maps every property to the task(s) that must prove it.

---

## 1. SAFETY — what must NEVER happen

**SAFETY-001**: `runRuffCheck` MUST NOT call `agent()` when `implFiles` is empty.

**SAFETY-002**: `runMypyCheck` MUST NOT call `agent()` when `implFiles` is empty.

**SAFETY-003**: When ruff finds one or more E-code violations, `mypy` MUST NOT be invoked in that same attempt cycle.

**SAFETY-004**: When ruff finds one or more E-code violations, `pytest` MUST NOT be invoked in that same attempt cycle.

**SAFETY-005**: When ruff passes and mypy finds errors, `pytest` MUST NOT be invoked in that same attempt cycle.

**SAFETY-006**: The RED phase MUST NOT invoke `runRuffCheck` or `runMypyCheck` at any point.

**SAFETY-007**: `runRefactor` (lines 367–426 of `datum-tdd-act-lane.ts`) MUST NOT be modified by this feature — its call signature, body, and return type must remain identical to pre-feature state.

**SAFETY-008**: No new `FailureStage` enum value MUST be introduced; `stage` on `LaneOutcome` MUST remain `'GREEN'` for all ruff/mypy pre-check failures.

**SAFETY-009**: Ruff W-code-only violations MUST NOT block lane progression — `runRuffCheck` MUST return `{ passed: true }` when the violation array contains only W-prefixed codes and zero E-prefixed codes.

**SAFETY-010**: `runRuffCheck` and `runMypyCheck` MUST NOT run against test files (`testFiles`) — only `implFiles` from `classifyFiles()` are checked.

**SAFETY-011**: When `agent()` returns non-JSON output for the ruff call (e.g., `"command not found"`), `runRuffCheck` MUST NOT fail the lane — it MUST return `{ passed: true, errors: [] }`.

**SAFETY-012**: When `agent()` returns null or unparseable output for the mypy call, `runMypyCheck` MUST NOT fail the lane — it MUST return `{ passed: true, errors: [] }`.

---

## 2. LIVENESS — what must EVENTUALLY happen

**LIVENESS-001**: When ruff and mypy both pass on the first GREEN attempt, the existing `green.tests_pass` gate MUST eventually execute.

**LIVENESS-002**: When ruff or mypy fails on the first GREEN attempt, the GREEN retry agent MUST eventually be invoked with `model('deep')`.

**LIVENESS-003**: After the GREEN retry, ruff and mypy MUST eventually be re-run before pytest is attempted — the pre-check gate is not bypassed on retry.

**LIVENESS-004**: A lane with empty `implFiles` MUST eventually reach the existing pytest gate without either pre-check executing.

**LIVENESS-005**: When both pre-checks pass and `green.tests_pass` is true, the lane MUST eventually proceed to the REFACTOR phase unchanged.

**LIVENESS-006**: When the GREEN retry exhausts retries with persistent pre-check failures, a `LaneOutcome` with `status: 'failed'` MUST eventually be returned (the function must not hang).

---

## 3. INVARIANT — what must ALWAYS be true

**INVARIANT-001**: `LaneOutcome.stage` is ALWAYS `'GREEN'` when the failure originates from a ruff or mypy pre-check.

**INVARIANT-002**: `LaneOutcome.status` is ALWAYS `'failed'` when a ruff or mypy pre-check causes the lane to terminate.

**INVARIANT-003**: `runRuffCheck` ALWAYS returns an object with exactly the shape `{ passed: boolean; errors: Array<{ file: string; line: number; col: number; code: string; message: string }> }`.

**INVARIANT-004**: `runMypyCheck` ALWAYS returns an object with exactly the shape `{ passed: boolean; errors: Array<{ file: string; line: number; message: string }> }`.

**INVARIANT-005**: `LaneOutcome.error` ALWAYS begins with `ruff_lint_error:` when the lane fails due to ruff, and with `mypy_type_error:` when the lane fails due to mypy — matching the existing `<prefix>: <detail>` convention used by `file_ownership_violation:` and peers.

**INVARIANT-006**: Structural lanes (`lane.stage === 'structural'`) ALWAYS exit via `runRefactor` before the GREEN phase — the pre-checks are therefore never reachable for structural lanes.

**INVARIANT-007**: The errors array passed into the GREEN retry ALWAYS contains at most 10 entries (truncated by ascending line number) when more than 10 violations exist.

**INVARIANT-008**: `skills/datum-tdd-act-lane.js` ALWAYS reflects the current TypeScript source in `skills/src/datum-tdd-act-lane.ts` — the generated file is never committed out of sync with its source.

---

## 4. BOUNDARY — valid input ranges

**BOUNDARY-001**: `runRuffCheck` with an `implFiles` array of exactly one element MUST invoke `agent()` once and return structured results.

**BOUNDARY-002**: `runRuffCheck` with 11 or more E-code violations MUST return exactly 10 errors (top 10 by ascending line number) when those errors are passed to the GREEN retry context.

**BOUNDARY-003**: `runMypyCheck` with mypy output containing lines both with and without `: error:` MUST include only the error lines in its `errors` array.

**BOUNDARY-004**: `runRuffCheck` with a JSON array of exactly zero violations MUST return `{ passed: true, errors: [] }`.

**BOUNDARY-005**: `runMypyCheck` with output containing zero `: error:` lines MUST return `{ passed: true, errors: [] }` regardless of exit code.

**BOUNDARY-006**: The `failure_reason` string injected into `greenRetryPacketStr` MUST be non-empty and MUST reference at least the failing tool name, file path, and line number when at least one violation exists.

---

## 5. IDEMPOTENT — what is safe to run twice

**IDEMPOTENT-001**: Running `bash scripts/build-workflows.sh` twice in succession MUST produce the same `skills/datum-tdd-act-lane.js` output (deterministic build with no timestamp-based drift).

**IDEMPOTENT-002**: Calling `runRuffCheck` twice on the same `implFiles` with no file changes between calls MUST return the same `{ passed, errors }` result.

**IDEMPOTENT-003**: Calling `runMypyCheck` twice on the same `implFiles` with no file changes between calls MUST return the same `{ passed, errors }` result.

**IDEMPOTENT-004**: When the GREEN retry re-runs ruff and mypy and both pass, proceeding to pytest MUST produce equivalent behavior to the first-attempt pass path — no duplicate commits, no duplicate agent calls.

---

## 6. ORDERING — order invariants

**ORDERING-001**: Within a single GREEN attempt, checks MUST execute in the order: ruff → mypy → pytest. No step is invoked if a prior step fails.

**ORDERING-002**: The GREEN agent `agent()` call MUST complete (and `green.success` must be truthy) BEFORE `runRuffCheck` is invoked for that attempt.

**ORDERING-003**: `runRuffCheck` MUST complete and return `passed: true` BEFORE `runMypyCheck` is invoked.

**ORDERING-004**: `runMypyCheck` MUST complete and return `passed: true` BEFORE the existing `green.tests_pass` pytest gate is invoked.

**ORDERING-005**: The GREEN retry agent call MUST complete BEFORE the post-retry ruff+mypy+pytest sequence begins.

**ORDERING-006**: Error truncation (top-10 by line number) MUST be applied BEFORE errors are serialized into `greenRetryPacketStr` — the retry agent never receives more than 10 violation entries.

---

## 7. ISOLATION — what cannot leak between contexts

**ISOLATION-001**: Pre-check results (ruff/mypy errors) from lane A MUST NOT appear in the retry context of lane B — each lane manages its own `implFiles` scope and its own `greenRetryPacketStr`.

**ISOLATION-002**: `runRuffCheck` and `runMypyCheck` MUST only operate on `implFiles` declared in the lane plan for the current `taskId` — they MUST NOT scan the whole worktree or `git diff --name-only HEAD`.

**ISOLATION-003**: A ruff/mypy failure in the GREEN phase MUST NOT modify, skip, or short-circuit the RED phase outcome that was already committed — RED commits are immutable once the GREEN phase begins.

**ISOLATION-004**: The `LaneOutcome` returned on pre-check failure MUST NOT include fields from the existing pytest-failure path (e.g., `green.test_errors`) — only the pre-check error string is encoded.

---

## 8. PERFORMANCE — latency/throughput/size bounds

**PERFORMANCE-001**: Combined wall-clock time for `runRuffCheck` + `runMypyCheck` (both passing) on a typical impl file set MUST be less than 5 seconds.

**PERFORMANCE-002**: Each pre-check `agent()` call MUST consume fewer than 500 tokens (prompt + response combined).

**PERFORMANCE-003**: The errors array serialized into `greenRetryPacketStr` MUST contain at most 10 entries — enforced by truncation before serialization.

**PERFORMANCE-004**: `runRuffCheck` with `implFiles.length === 0` MUST return synchronously (or as fast as a resolved promise) without incurring any `agent()` round-trip latency.

**PERFORMANCE-005**: `runMypyCheck` with `implFiles.length === 0` MUST return synchronously without any `agent()` round-trip latency.

---

## 9. SECURITY — access controls

**SECURITY-001**: Neither `runRuffCheck` nor `runMypyCheck` MUST introduce `eval()`, `os.system()`, or `shell=True` patterns — all shell execution MUST route through the existing `agent()` abstraction per SEC-001.

**SECURITY-002**: The `implFiles` list passed to ruff and mypy MUST be the exact list from `classifyFiles(lane.files)` — no dynamic file path construction from user-controlled or external input is permitted.

---

## 10. OBSERVABILITY — what must be logged or measured

**OBSERVABILITY-001**: A `log()` call MUST be emitted before each `runRuffCheck` invocation, identifying the task and the files being checked.

**OBSERVABILITY-002**: A `log()` call MUST be emitted after `runRuffCheck` returns, recording whether it passed or failed and the violation count.

**OBSERVABILITY-003**: A `log()` call MUST be emitted before each `runMypyCheck` invocation, identifying the task and the files being checked.

**OBSERVABILITY-004**: A `log()` call MUST be emitted after `runMypyCheck` returns, recording whether it passed or failed and the error count.

**OBSERVABILITY-005**: When `runRuffCheck` is skipped due to empty `implFiles`, a `log()` call MUST record the skip reason.

**OBSERVABILITY-006**: When `runMypyCheck` is skipped due to empty `implFiles`, a `log()` call MUST record the skip reason.

**OBSERVABILITY-007**: When ruff or mypy is not found in PATH (tool-not-found), a warning-level `log()` MUST be emitted identifying which tool was missing before proceeding.

**OBSERVABILITY-008**: `LaneOutcome.error` MUST always encode the catching tool name as a prefix (`ruff_lint_error:` or `mypy_type_error:`) so downstream triage agents can identify which pre-check failed by inspecting the string — no separate structured field is required.

---

## 11. COMPATIBILITY — existing behavior that must be preserved

**COMPAT-001**: When `implFiles` is empty, lane behavior MUST be byte-for-byte identical to pre-feature behavior — no new log lines, no new agent calls, no altered `LaneOutcome` shape.

**COMPAT-002**: The `LaneOutcome` type signature (fields `task_id`, `status`, `stage`, `error`) MUST remain unchanged — no new fields are added unless Q5 resolves to structured field (in which case the field is additive and optional).

**COMPAT-003**: The existing `green.tests_pass` pytest verification gate (lines 299–313) MUST remain intact and be reached on the same code path as before when ruff and mypy both pass.

**COMPAT-004**: The GREEN retry escalation to `model('deep')` MUST continue to fire on the first test-failure (not pre-check failure) exactly as it did pre-feature — ruff/mypy failures use the same escalation, not a different one.

**COMPAT-005**: `runRefactor` (lines 367–426) MUST be called with the same arguments and at the same point in the lane flow as before — this feature does not alter its invocation.

**COMPAT-006**: Structural lanes that route through `runRefactor` at line 107 MUST continue to bypass the GREEN phase entirely — the ruff/mypy gate is never reachable for structural lanes.

**COMPAT-007**: The `classifyFiles()` function in `skills/src/shared/utils.ts` MUST NOT be modified by this feature.

**COMPAT-008**: The generated file `skills/datum-tdd-act-lane.js` MUST be rebuilt via `bash scripts/build-workflows.sh` after any TypeScript edit and the result MUST contain the new ruff/mypy check logic.

---

## Traceability Table

| Property ID | Category | Predicate (summary) | Task IDs |
|---|---|---|---|
| SAFETY-001 | SAFETY | `runRuffCheck` never calls `agent()` when `implFiles` is empty | task-1 |
| SAFETY-002 | SAFETY | `runMypyCheck` never calls `agent()` when `implFiles` is empty | task-2 |
| SAFETY-003 | SAFETY | mypy not called when ruff finds E-code violations | task-3 |
| SAFETY-004 | SAFETY | pytest not called when ruff finds E-code violations | task-3 |
| SAFETY-005 | SAFETY | pytest not called when mypy finds errors (ruff passed) | task-3 |
| SAFETY-006 | SAFETY | RED phase never invokes ruff or mypy pre-checks | task-3 |
| SAFETY-007 | SAFETY | `runRefactor` body is not modified | task-3 |
| SAFETY-008 | SAFETY | No new `FailureStage` enum; `stage` stays `'GREEN'` for pre-check failures | task-1, task-2, task-3 |
| SAFETY-009 | SAFETY | W-code-only violations do not block (`runRuffCheck` returns `passed: true`) | task-1 |
| SAFETY-010 | SAFETY | Only `implFiles` are checked, never `testFiles` | task-1, task-2 |
| SAFETY-011 | SAFETY | Non-JSON ruff output does not fail the lane | task-1 |
| SAFETY-012 | SAFETY | Null/unparseable mypy output does not fail the lane | task-2 |
| LIVENESS-001 | LIVENESS | ruff+mypy both pass → `green.tests_pass` gate executes | task-3 |
| LIVENESS-002 | LIVENESS | ruff or mypy failure → GREEN retry with `model('deep')` eventually invoked | task-3 |
| LIVENESS-003 | LIVENESS | After GREEN retry, ruff+mypy re-run before pytest | task-3 |
| LIVENESS-004 | LIVENESS | Empty `implFiles` → pytest gate reached without pre-checks | task-3 |
| LIVENESS-005 | LIVENESS | Pre-checks pass + tests pass → REFACTOR phase proceeds | task-3 |
| LIVENESS-006 | LIVENESS | Exhausted retries → `LaneOutcome` with `status: 'failed'` returned | task-3 |
| INVARIANT-001 | INVARIANT | `LaneOutcome.stage === 'GREEN'` for all pre-check failures | task-3 |
| INVARIANT-002 | INVARIANT | `LaneOutcome.status === 'failed'` when pre-check terminates lane | task-3 |
| INVARIANT-003 | INVARIANT | `runRuffCheck` return shape is always `{ passed, errors[{file,line,col,code,message}] }` | task-1 |
| INVARIANT-004 | INVARIANT | `runMypyCheck` return shape is always `{ passed, errors[{file,line,message}] }` | task-2 |
| INVARIANT-005 | INVARIANT | `LaneOutcome.error` always starts with `ruff_lint_error:` or `mypy_type_error:` on pre-check failure | task-3 |
| INVARIANT-006 | INVARIANT | Structural lanes always exit via `runRefactor`, never reaching pre-checks | task-3 |
| INVARIANT-007 | INVARIANT | Errors passed to retry always ≤ 10 entries (top 10 by line number) | task-3 |
| INVARIANT-008 | INVARIANT | `datum-tdd-act-lane.js` always reflects current TS source after build | task-1, task-2, task-3 |
| BOUNDARY-001 | BOUNDARY | Single-file `implFiles` → `agent()` called once, results structured | task-1 |
| BOUNDARY-002 | BOUNDARY | 11+ E-code violations → exactly 10 in retry context | task-3 |
| BOUNDARY-003 | BOUNDARY | Mixed mypy output → only `: error:` lines in `errors` array | task-2 |
| BOUNDARY-004 | BOUNDARY | Empty violation JSON array → `{ passed: true, errors: [] }` | task-1 |
| BOUNDARY-005 | BOUNDARY | Zero `: error:` lines in mypy output → `{ passed: true, errors: [] }` | task-2 |
| BOUNDARY-006 | BOUNDARY | `failure_reason` in retry is non-empty with tool, file, line | task-3 |
| IDEMPOTENT-001 | IDEMPOTENT | Build script produces identical JS on repeated runs | task-1, task-2, task-3 |
| IDEMPOTENT-002 | IDEMPOTENT | `runRuffCheck` called twice with same files → same result | task-1 |
| IDEMPOTENT-003 | IDEMPOTENT | `runMypyCheck` called twice with same files → same result | task-2 |
| IDEMPOTENT-004 | IDEMPOTENT | Retry passing pre-checks → no duplicate commits or agent calls | task-3 |
| ORDERING-001 | ORDERING | Check order is always ruff → mypy → pytest within one GREEN attempt | task-3 |
| ORDERING-002 | ORDERING | `green.success` truthy before `runRuffCheck` is called | task-3 |
| ORDERING-003 | ORDERING | `runRuffCheck` returns `passed: true` before `runMypyCheck` is called | task-3 |
| ORDERING-004 | ORDERING | `runMypyCheck` returns `passed: true` before pytest gate | task-3 |
| ORDERING-005 | ORDERING | GREEN retry completes before post-retry ruff+mypy+pytest sequence | task-3 |
| ORDERING-006 | ORDERING | Truncation applied before serialization into `greenRetryPacketStr` | task-3 |
| ISOLATION-001 | ISOLATION | Pre-check errors from lane A never appear in retry context of lane B | task-3 |
| ISOLATION-002 | ISOLATION | Only `implFiles` for current `taskId` are checked, not whole worktree | task-1, task-2 |
| ISOLATION-003 | ISOLATION | ruff/mypy failure in GREEN does not alter RED-phase committed state | task-3 |
| ISOLATION-004 | ISOLATION | Pre-check `LaneOutcome` does not include pytest-failure fields | task-3 |
| PERFORMANCE-001 | PERFORMANCE | ruff + mypy (passing) wall-clock < 5 seconds | task-1, task-2 |
| PERFORMANCE-002 | PERFORMANCE | Each pre-check `agent()` call < 500 tokens | task-1, task-2 |
| PERFORMANCE-003 | PERFORMANCE | Errors in `greenRetryPacketStr` ≤ 10 entries | task-3 |
| PERFORMANCE-004 | PERFORMANCE | `runRuffCheck([], ...)` returns without `agent()` round-trip | task-1 |
| PERFORMANCE-005 | PERFORMANCE | `runMypyCheck([], ...)` returns without `agent()` round-trip | task-2 |
| SECURITY-001 | SECURITY | No `eval`, `os.system`, or `shell=True` in new code; routes through `agent()` | task-1, task-2 |
| SECURITY-002 | SECURITY | `implFiles` is the unmodified list from `classifyFiles()`, no dynamic path construction | task-1, task-2 |
| OBSERVABILITY-001 | OBSERVABILITY | `log()` emitted before `runRuffCheck` invocation | task-1 |
| OBSERVABILITY-002 | OBSERVABILITY | `log()` emitted after `runRuffCheck` with pass/fail and violation count | task-1 |
| OBSERVABILITY-003 | OBSERVABILITY | `log()` emitted before `runMypyCheck` invocation | task-2 |
| OBSERVABILITY-004 | OBSERVABILITY | `log()` emitted after `runMypyCheck` with pass/fail and error count | task-2 |
| OBSERVABILITY-005 | OBSERVABILITY | `log()` emitted when ruff check skipped due to empty `implFiles` | task-1 |
| OBSERVABILITY-006 | OBSERVABILITY | `log()` emitted when mypy check skipped due to empty `implFiles` | task-2 |
| OBSERVABILITY-007 | OBSERVABILITY | Warning `log()` emitted when ruff or mypy not found in PATH | task-1, task-2 |
| OBSERVABILITY-008 | OBSERVABILITY | `LaneOutcome.error` prefix encodes failing tool — no separate structured field needed | task-3 |
| COMPAT-001 | COMPATIBILITY | Empty `implFiles` → behavior identical to pre-feature (no new logs, no new calls) | task-3 |
| COMPAT-002 | COMPATIBILITY | `LaneOutcome` type signature unchanged | task-1, task-2, task-3 |
| COMPAT-003 | COMPATIBILITY | `green.tests_pass` gate remains intact and reachable on the same code path | task-3 |
| COMPAT-004 | COMPATIBILITY | Test-failure retry escalation to `model('deep')` unchanged from pre-feature | task-3 |
| COMPAT-005 | COMPATIBILITY | `runRefactor` invoked with same args at same flow point | task-3 |
| COMPAT-006 | COMPATIBILITY | Structural lanes still bypass GREEN phase entirely | task-3 |
| COMPAT-007 | COMPATIBILITY | `classifyFiles()` in `shared/utils.ts` is not modified | task-1, task-2 |
| COMPAT-008 | COMPATIBILITY | `skills/datum-tdd-act-lane.js` rebuilt after TS edit and contains new logic | task-1, task-2, task-3 |

---

## Per-Task Property Assignments

### task-1: Add `runRuffCheck` helper

Primary properties this task must prove:

- SAFETY-001, SAFETY-008, SAFETY-009, SAFETY-010, SAFETY-011
- INVARIANT-003, INVARIANT-008
- BOUNDARY-001, BOUNDARY-002 (truncation contract defined here), BOUNDARY-004
- IDEMPOTENT-001, IDEMPOTENT-002
- ISOLATION-002
- PERFORMANCE-001, PERFORMANCE-002, PERFORMANCE-004
- SECURITY-001, SECURITY-002
- OBSERVABILITY-001, OBSERVABILITY-002, OBSERVABILITY-005, OBSERVABILITY-007
- COMPAT-002, COMPAT-007, COMPAT-008

### task-2: Add `runMypyCheck` helper

Primary properties this task must prove:

- SAFETY-002, SAFETY-008, SAFETY-010, SAFETY-012
- INVARIANT-004, INVARIANT-008
- BOUNDARY-003, BOUNDARY-005
- IDEMPOTENT-001, IDEMPOTENT-003
- ISOLATION-002
- PERFORMANCE-001, PERFORMANCE-002, PERFORMANCE-005
- SECURITY-001, SECURITY-002
- OBSERVABILITY-003, OBSERVABILITY-004, OBSERVABILITY-006, OBSERVABILITY-007
- COMPAT-002, COMPAT-007, COMPAT-008

### task-3: Wire ruff+mypy pre-checks into GREEN phase with retry passback

Primary properties this task must prove:

- SAFETY-003, SAFETY-004, SAFETY-005, SAFETY-006, SAFETY-007, SAFETY-008
- LIVENESS-001, LIVENESS-002, LIVENESS-003, LIVENESS-004, LIVENESS-005, LIVENESS-006
- INVARIANT-001, INVARIANT-002, INVARIANT-005, INVARIANT-006, INVARIANT-007, INVARIANT-008
- BOUNDARY-002, BOUNDARY-006
- IDEMPOTENT-001, IDEMPOTENT-004
- ORDERING-001, ORDERING-002, ORDERING-003, ORDERING-004, ORDERING-005, ORDERING-006
- ISOLATION-001, ISOLATION-003, ISOLATION-004
- PERFORMANCE-003
- OBSERVABILITY-008
- COMPAT-001, COMPAT-002, COMPAT-003, COMPAT-004, COMPAT-005, COMPAT-006, COMPAT-008
