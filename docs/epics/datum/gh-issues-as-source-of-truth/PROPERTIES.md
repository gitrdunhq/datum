# PROPERTIES.md — GitHub Issues as Source of Truth for Lane IDs

Derived from SPEC.md requirements R1–R7. Each property is a testable predicate.
Categories: SAFETY, LIVENESS, INVARIANT, BOUNDARY, IDEMPOTENT, ORDERING, ISOLATION, PERFORMANCE, SECURITY, OBSERVABILITY, COMPATIBILITY.

---

## 1. Property List by Category

### SAFETY — what must NEVER happen

**PROPERTY(SAFETY-001):** `datum lane-plan` without `--gh-issues` must never invoke any subprocess call to `gh` or any function in `github_issues.py` (zero GH API calls).

**PROPERTY(SAFETY-002):** `link_sub_issues` must never raise an exception when the GH API returns an already-linked conflict (stderr contains "already"); the error is silently swallowed regardless of how many times it occurs.

**PROPERTY(SAFETY-003):** `create_issues_from_plan` must never create a duplicate GH issue when an open issue with a title matching the lane's title (case-insensitive) already exists.

**PROPERTY(SAFETY-004):** If `create_issues_from_plan` raises during `create_epic_with_tasks`, the function must not silently continue — no partial sub-issue links are created and the exception propagates to the caller.

**PROPERTY(SAFETY-005):** If `task_map` is missing a `task_id` present in `lanes`, `datum lane-plan --gh-issues` must not overwrite `lane-plan.json` with partial data — a `KeyError` is raised before any write occurs.

**PROPERTY(SAFETY-006):** GH sync failure in `datum-tdd-act` (network error, expired token) must never abort the pipeline — the pipeline result and exit code are unaffected.

**PROPERTY(SAFETY-007):** `link_sub_issues` with a non-409 GH API failure (e.g. 404 not found, 403 forbidden) must always re-raise the `RuntimeError` from `_gh_check`.

**PROPERTY(SAFETY-008):** No test in `tests/test_github_issues.py` or `tests/test_units.py` (new additions) may make a live network call to the GH API — all GH I/O must be mocked at the `_gh` / `_gh_check` / `subprocess.run` boundary.

**PROPERTY(SAFETY-009):** `_gh` must always unset `GITHUB_TOKEN` in the subprocess environment (consistent with existing `_gh` at line 34); new public functions must not bypass this by calling `subprocess.run` directly.

---

### LIVENESS — what must EVENTUALLY happen

**PROPERTY(LIVENESS-001):** `create_issues_from_plan` with N lanes must eventually return a dict with exactly N entries once all GH API calls complete (no entries are silently dropped).

**PROPERTY(LIVENESS-002):** `create_epic_with_tasks` must eventually call `link_sub_issues` with all task issue numbers after successfully creating the epic and all child tasks.

**PROPERTY(LIVENESS-003):** When a lane with a `#N` `task_id` completes in `datum-tdd-act`, GH issue `#N` must eventually be closed with the `datum-done` label applied.

**PROPERTY(LIVENESS-004):** When a lane with a `#N` `task_id` fails, GH issue `#N` must eventually receive a comment containing the failure reason.

**PROPERTY(LIVENESS-005):** `datum lane-plan --gh-issues` must eventually write `lane-plan.json` with every lane's `task_id` converted to `#N` format and an `epic_issue` key at the top level.

---

### INVARIANT — what must ALWAYS be true

**PROPERTY(INVARIANT-001):** `parse_issue_metadata(build_issue_body(lane))` must always return a dict with keys `files`, `depends_on`, and `acceptance_criteria` whose values are semantically equal to the corresponding values in the original `lane` dict (key/value equality, not byte-for-byte JSON).

**PROPERTY(INVARIANT-002):** The JSON inside the `<!-- datum:metadata ... -->` HTML comment produced by `build_issue_body` must always be valid JSON — `json.loads(extracted_fragment)` must not raise.

**PROPERTY(INVARIANT-003):** Every `task_id` key in the dict returned by `create_issues_from_plan` must appear as a key in the input `lane_plan['lanes']` dict (no phantom entries, no missing entries).

**PROPERTY(INVARIANT-004):** Every value in the dict returned by `create_issues_from_plan` must be a positive integer (GH issue number > 0).

**PROPERTY(INVARIANT-005):** The dict returned by `create_epic_with_tasks` must always contain exactly two keys: `epic_number` (positive int) and `task_map` (dict mapping each `task_id` to a positive int).

**PROPERTY(INVARIANT-006):** `wave_builder.validate_lane_plan` must not raise when called on `lane-plan.json` produced by `datum lane-plan --gh-issues` — `#N` lane IDs must satisfy all structural constraints (presence of `id` and `files` keys, `topological_order` referencing only valid lane keys).

**PROPERTY(INVARIANT-007):** `build_issue_body(lane)` must always return a string containing the exact substring `<!-- datum:metadata`.

**PROPERTY(INVARIANT-008):** `parse_issue_metadata` must always return `None` when the input body string contains no `<!-- datum:metadata` comment.

**PROPERTY(INVARIANT-009):** In `lane-plan.json` produced by `--gh-issues`, every `depends_on` reference that was a `task-XXX` string must be replaced with the `#N` string corresponding to that task's assigned GH issue number from `task_map`.

**PROPERTY(INVARIANT-010):** `parse_issue_metadata` is callable by that exact public name from `datum.github_issues` (it is an exported alias, not a private name).

---

### BOUNDARY — valid input ranges

**PROPERTY(BOUNDARY-001):** `link_sub_issues` with `child_numbers=[]` (empty list) must return `None` without making any GH API calls.

**PROPERTY(BOUNDARY-002):** `create_issues_from_plan` must raise `TypeError` when any `task_id` value in `lane_plan['lanes']` is not a string.

**PROPERTY(BOUNDARY-003):** `link_sub_issues` with a single-element `child_numbers` list must call `link_sub_issue` exactly once.

**PROPERTY(BOUNDARY-004):** `build_issue_body` must handle lane dicts where `depends_on` is an empty list, `files` is an empty list, and `acceptance_criteria` is an empty list without raising.

**PROPERTY(BOUNDARY-005):** `create_issues_from_plan` with a single-lane `lane_plan` must return a dict with exactly one entry.

**PROPERTY(BOUNDARY-006):** `datum lane-plan --gh-issues` must raise (and not write partial output) when `task_map` is missing any `task_id` present in `lanes` — the KeyError surfaces before the file is written.

---

### IDEMPOTENT — what is safe to run twice

**PROPERTY(IDEMPOTENT-001):** Calling `link_sub_issues(parent, [c1, c2], repo)` twice with identical arguments must not raise on the second call — the already-linked conflict is swallowed silently both times.

**PROPERTY(IDEMPOTENT-002):** Calling `create_issues_from_plan` when all lanes already have matching open GH issues must return a dict mapping each `task_id` to the existing issue number without creating any new issues.

**PROPERTY(IDEMPOTENT-003):** `update_issue_stage(issue_number, 'done')` closing an already-closed issue must not raise (GH CLI is tolerant of close on a closed issue, and `_gh` — not `_gh_check` — is used for close).

---

### ORDERING — order invariants

**PROPERTY(ORDERING-001):** In `create_epic_with_tasks`, `link_sub_issues` must be called after both `create_epic` and `create_issues_from_plan` have returned successfully — never before either.

**PROPERTY(ORDERING-002):** In `datum lane-plan --gh-issues`, `lane-plan.json` must not be overwritten with `#N` IDs until `create_epic_with_tasks` has returned a complete `task_map` covering all lanes.

**PROPERTY(ORDERING-003):** In `datum-tdd-act`, GH lane status sync must occur after the lane result (completed or failed) is determined — never before.

**PROPERTY(ORDERING-004):** In `build_issue_body`, the `<!-- datum:metadata ... -->` HTML comment must be present in the returned string such that `METADATA_PATTERN` can find it regardless of its position relative to human-readable prose.

---

### ISOLATION — what cannot leak between contexts

**PROPERTY(ISOLATION-001):** The `--gh-issues` flag must not affect `lane-plan.json` lane IDs or `tasks.json` when omitted — local `task-XXX` IDs are the only output.

**PROPERTY(ISOLATION-002):** GH sync failures in `datum-tdd-act` must not propagate to the pipeline result object — the `status` of the pipeline is set by TDD logic only, never by GH sync outcome.

**PROPERTY(ISOLATION-003):** `create_issues_from_plan` dedup logic must not cross-contaminate lanes — reusing an existing issue for lane A must not affect issue creation or lookup for lane B.

**PROPERTY(ISOLATION-004):** The existing `_build_issue_body` (private function) and `create_task` must continue to function without modification after `build_issue_body` (public) is added — no shared mutable state may be introduced between them.

---

### PERFORMANCE — latency/throughput/size bounds

**PROPERTY(PERFORMANCE-001):** Each per-lane title search (`gh issue list --search`) used for dedup in `create_issues_from_plan` must complete within 5 seconds per lane under normal GH API conditions.

**PROPERTY(PERFORMANCE-002):** `build_issue_body` is a pure string-manipulation function with no I/O; it must return in < 1 ms for any lane dict of reasonable size (< 100 acceptance criteria, < 100 files).

---

### SECURITY — access controls

**PROPERTY(SECURITY-001):** All `_gh` invocations in new public functions must set `GITHUB_TOKEN=""` in the subprocess environment, consistent with the existing `_gh` helper (line 34 of `github_issues.py`), preventing token leakage via inherited environment.

**PROPERTY(SECURITY-002):** If `gh auth status` fails (no valid auth) before any GH issue creation begins, `_gh_check` must raise `RuntimeError` before any issues are created — no partial state is left on GH.

**PROPERTY(SECURITY-003):** GH lane sync in `datum-tdd-act` must use `datum gh-sync-lane` (shelling out to the `datum` CLI), which inherits `GITHUB_TOKEN` unsetting from `_gh` — direct `gh` calls with inherited token must not be used.

---

### OBSERVABILITY — what must be logged or measured

**PROPERTY(OBSERVABILITY-001):** When GH sync fails in `datum-tdd-act`, the error must be printed to stderr (visible in CI logs) before the pipeline continues.

**PROPERTY(OBSERVABILITY-002):** `update_issue_stage(issue_number, 'done')` must post a comment to the GH issue (e.g., "Lane completed.") in addition to closing it and updating the label.

**PROPERTY(OBSERVABILITY-003):** When a lane fails and `datum gh-sync-lane --status failed --error '<reason>'` is called, the comment posted to GH issue #N must contain the verbatim failure reason string.

**PROPERTY(OBSERVABILITY-004):** `datum gh-sync-lane` must exit with code 0 even when the underlying GH API call fails — the error is logged to stderr only.

---

### COMPATIBILITY — existing behavior that must be preserved

**PROPERTY(COMPAT-001):** `datum lane-plan` without `--gh-issues` must produce output byte-for-byte identical to the current behavior (same `task-XXX` IDs, same JSON structure, no new keys).

**PROPERTY(COMPAT-002):** `create_task` must continue to call `_build_issue_body` (private) without regression — the new public `build_issue_body` must not replace or shadow the private function as called by `create_task`.

**PROPERTY(COMPAT-003):** `parse_metadata` (the original private name) must remain callable — adding `parse_issue_metadata` as an alias must not remove or rename the original.

**PROPERTY(COMPAT-004):** `pipeline_scheduler.py`, `wave_builder.py`, `status_render.py`, and `spec_drift_detector.py` must require zero code changes to handle `#N` lane IDs — these files use lane IDs as dict keys only and `#N` strings are structurally compatible.

**PROPERTY(COMPAT-005):** `pytest tests/` must pass with no errors (no regressions) after all new code is added.

**PROPERTY(COMPAT-006):** `build_lane_plan_from_epic` must continue to work unchanged — it already uses `#N` ID format and must not be affected by any new public function additions.

---

## 2. Traceability Table

| Property ID | Category | Predicate (short form) | Task IDs |
|---|---|---|---|
| SAFETY-001 | SAFETY | No GH calls when `--gh-issues` absent | task-005 |
| SAFETY-002 | SAFETY | `link_sub_issues` swallows already-linked conflict | task-003 |
| SAFETY-003 | SAFETY | No duplicate issue created when title match exists | task-002 |
| SAFETY-004 | SAFETY | `create_epic_with_tasks` fail-fast on child creation error | task-004 |
| SAFETY-005 | SAFETY | No partial `lane-plan.json` write on `KeyError` | task-005 |
| SAFETY-006 | SAFETY | GH sync failure does not abort pipeline | task-006 |
| SAFETY-007 | SAFETY | Non-409 GH error re-raises `RuntimeError` | task-003 |
| SAFETY-008 | SAFETY | All tests mock GH I/O — no live network calls | task-001, task-002, task-003, task-004, task-005, task-006 |
| SAFETY-009 | SAFETY | `GITHUB_TOKEN` unset in all new `_gh` invocations | task-001, task-002, task-003, task-004, task-005, task-006 |
| LIVENESS-001 | LIVENESS | `create_issues_from_plan` returns N entries for N lanes | task-002 |
| LIVENESS-002 | LIVENESS | `create_epic_with_tasks` calls `link_sub_issues` with all children | task-004 |
| LIVENESS-003 | LIVENESS | Completed `#N` lane closes GH issue with `datum-done` | task-006 |
| LIVENESS-004 | LIVENESS | Failed `#N` lane posts comment with failure reason | task-006 |
| LIVENESS-005 | LIVENESS | `--gh-issues` writes `#N` IDs and `epic_issue` key | task-005 |
| INVARIANT-001 | INVARIANT | `parse_issue_metadata(build_issue_body(lane))` round-trips | task-001 |
| INVARIANT-002 | INVARIANT | Metadata JSON in HTML comment is valid JSON | task-001 |
| INVARIANT-003 | INVARIANT | `create_issues_from_plan` dict keys == input `task_id` keys | task-002 |
| INVARIANT-004 | INVARIANT | All values in `create_issues_from_plan` result are positive ints | task-002 |
| INVARIANT-005 | INVARIANT | `create_epic_with_tasks` result has `epic_number` + `task_map` | task-004 |
| INVARIANT-006 | INVARIANT | `validate_lane_plan` passes on `--gh-issues` output | task-005 |
| INVARIANT-007 | INVARIANT | `build_issue_body` always contains `<!-- datum:metadata` | task-001 |
| INVARIANT-008 | INVARIANT | `parse_issue_metadata` returns `None` on missing comment | task-001 |
| INVARIANT-009 | INVARIANT | `depends_on` in `lane-plan.json` uses `#N` after remap | task-005 |
| INVARIANT-010 | INVARIANT | `parse_issue_metadata` is a public exported name | task-001 |
| BOUNDARY-001 | BOUNDARY | `link_sub_issues([])` no-op, no API calls | task-003 |
| BOUNDARY-002 | BOUNDARY | `create_issues_from_plan` raises `TypeError` on non-string `task_id` | task-002 |
| BOUNDARY-003 | BOUNDARY | `link_sub_issues` with one child calls `link_sub_issue` exactly once | task-003 |
| BOUNDARY-004 | BOUNDARY | `build_issue_body` handles empty lists without raising | task-001 |
| BOUNDARY-005 | BOUNDARY | Single-lane `lane_plan` returns one-entry dict | task-002 |
| BOUNDARY-006 | BOUNDARY | Missing `task_id` in `task_map` raises before write | task-005 |
| IDEMPOTENT-001 | IDEMPOTENT | Second call to `link_sub_issues` with same args does not raise | task-003 |
| IDEMPOTENT-002 | IDEMPOTENT | `create_issues_from_plan` reuses existing issues, creates none | task-002 |
| IDEMPOTENT-003 | IDEMPOTENT | `update_issue_stage(..., 'done')` on already-closed issue does not raise | task-006 |
| ORDERING-001 | ORDERING | `link_sub_issues` called after `create_epic` + `create_issues_from_plan` | task-004 |
| ORDERING-002 | ORDERING | `lane-plan.json` not overwritten until complete `task_map` available | task-005 |
| ORDERING-003 | ORDERING | GH sync happens after lane result is determined | task-006 |
| ORDERING-004 | ORDERING | `METADATA_PATTERN` can find comment regardless of position in body | task-001 |
| ISOLATION-001 | ISOLATION | Absent `--gh-issues` flag produces local IDs only | task-005 |
| ISOLATION-002 | ISOLATION | GH sync failures do not set pipeline `status` | task-006 |
| ISOLATION-003 | ISOLATION | Dedup for lane A does not affect lane B | task-002 |
| ISOLATION-004 | ISOLATION | New public `build_issue_body` does not break `create_task` / `_build_issue_body` | task-001 |
| PERFORMANCE-001 | PERFORMANCE | Per-lane title search completes within 5 seconds | task-002 |
| PERFORMANCE-002 | PERFORMANCE | `build_issue_body` returns in < 1 ms (pure string function) | task-001 |
| SECURITY-001 | SECURITY | `GITHUB_TOKEN=""` in all new subprocess envs | task-001, task-002, task-003, task-004, task-005, task-006 |
| SECURITY-002 | SECURITY | Auth failure raises before any issues are created | task-002, task-004 |
| SECURITY-003 | SECURITY | `datum-tdd-act` GH sync uses `datum gh-sync-lane`, not raw `gh` | task-006 |
| OBSERVABILITY-001 | OBSERVABILITY | GH sync failure printed to stderr before pipeline continues | task-006 |
| OBSERVABILITY-002 | OBSERVABILITY | `update_issue_stage('done')` posts comment + closes issue + updates label | task-006 |
| OBSERVABILITY-003 | OBSERVABILITY | Failure comment contains verbatim failure reason string | task-006 |
| OBSERVABILITY-004 | OBSERVABILITY | `datum gh-sync-lane` exits 0 even on GH API failure | task-006 |
| COMPAT-001 | COMPATIBILITY | `lane-plan` without flag produces identical output to current behavior | task-005 |
| COMPAT-002 | COMPATIBILITY | `create_task` calls `_build_issue_body` without regression | task-001 |
| COMPAT-003 | COMPATIBILITY | `parse_metadata` original name remains callable | task-001 |
| COMPAT-004 | COMPATIBILITY | Downstream files (`pipeline_scheduler`, etc.) need zero changes | task-005 |
| COMPAT-005 | COMPATIBILITY | `pytest tests/` passes with no regressions | task-001, task-002, task-003, task-004, task-005, task-006 |
| COMPAT-006 | COMPATIBILITY | `build_lane_plan_from_epic` unaffected by new additions | task-001, task-004 |

---

## 3. Per-Task Property Assignments

### task-001: `build_issue_body` + `parse_issue_metadata`

| Property ID | Category | Predicate |
|---|---|---|
| INVARIANT-001 | INVARIANT | Round-trip equality: `parse_issue_metadata(build_issue_body(lane))` equals original metadata |
| INVARIANT-002 | INVARIANT | Extracted JSON is valid (`json.loads` succeeds) |
| INVARIANT-007 | INVARIANT | Output always contains `<!-- datum:metadata` |
| INVARIANT-008 | INVARIANT | Returns `None` on body without comment |
| INVARIANT-010 | INVARIANT | `parse_issue_metadata` is a public exported name |
| BOUNDARY-004 | BOUNDARY | Handles empty `files`, `depends_on`, `acceptance_criteria` without raising |
| ISOLATION-004 | ISOLATION | `create_task` / `_build_issue_body` unaffected by new public function |
| ORDERING-004 | ORDERING | `METADATA_PATTERN` finds comment regardless of position |
| PERFORMANCE-002 | PERFORMANCE | Returns in < 1 ms (pure string, no I/O) |
| SAFETY-008 | SAFETY | Tests mock all GH I/O |
| SAFETY-009 | SAFETY | No new raw subprocess calls bypassing `_gh` |
| SECURITY-001 | SECURITY | `GITHUB_TOKEN=""` in any new subprocess envs |
| COMPAT-002 | COMPATIBILITY | `create_task` / `_build_issue_body` regression-free |
| COMPAT-003 | COMPATIBILITY | `parse_metadata` original name remains callable |
| COMPAT-005 | COMPATIBILITY | `pytest tests/` passes |
| COMPAT-006 | COMPATIBILITY | `build_lane_plan_from_epic` unaffected |

---

### task-002: `create_issues_from_plan` with title-based dedup

| Property ID | Category | Predicate |
|---|---|---|
| SAFETY-003 | SAFETY | No duplicate issue when title match exists |
| SAFETY-008 | SAFETY | Tests mock all GH I/O |
| SAFETY-009 | SAFETY | `GITHUB_TOKEN=""` in subprocess envs |
| LIVENESS-001 | LIVENESS | Returns N entries for N-lane input |
| INVARIANT-003 | INVARIANT | Result keys == input `task_id` keys |
| INVARIANT-004 | INVARIANT | All values are positive integers |
| BOUNDARY-002 | BOUNDARY | Raises `TypeError` on non-string `task_id` |
| BOUNDARY-005 | BOUNDARY | Single-lane input returns one-entry dict |
| IDEMPOTENT-002 | IDEMPOTENT | Reuses existing issues; creates none when all match |
| ISOLATION-003 | ISOLATION | Dedup for lane A does not affect lane B |
| PERFORMANCE-001 | PERFORMANCE | Per-lane title search completes within 5 seconds |
| SECURITY-001 | SECURITY | `GITHUB_TOKEN=""` in subprocess envs |
| SECURITY-002 | SECURITY | Auth failure raises before any issues created |
| COMPAT-005 | COMPATIBILITY | `pytest tests/` passes |

---

### task-003: `link_sub_issues` batch linker with 409 swallowing

| Property ID | Category | Predicate |
|---|---|---|
| SAFETY-002 | SAFETY | Already-linked conflict swallowed silently |
| SAFETY-007 | SAFETY | Non-409 GH error re-raises `RuntimeError` |
| SAFETY-008 | SAFETY | Tests mock all GH I/O |
| SAFETY-009 | SAFETY | `GITHUB_TOKEN=""` in subprocess envs |
| BOUNDARY-001 | BOUNDARY | Empty `child_numbers` returns without API calls |
| BOUNDARY-003 | BOUNDARY | Single child calls `link_sub_issue` exactly once |
| IDEMPOTENT-001 | IDEMPOTENT | Second call with same args does not raise |
| SECURITY-001 | SECURITY | `GITHUB_TOKEN=""` in subprocess envs |
| COMPAT-005 | COMPATIBILITY | `pytest tests/` passes |

---

### task-004: `create_epic_with_tasks` orchestrator

| Property ID | Category | Predicate |
|---|---|---|
| SAFETY-004 | SAFETY | Fail-fast on child creation error; no silent partial links |
| SAFETY-008 | SAFETY | Tests mock all GH I/O |
| SAFETY-009 | SAFETY | `GITHUB_TOKEN=""` in subprocess envs |
| LIVENESS-002 | LIVENESS | `link_sub_issues` called with all children after creation |
| INVARIANT-005 | INVARIANT | Result has `epic_number` (positive int) + `task_map` (complete dict) |
| ORDERING-001 | ORDERING | `link_sub_issues` called after `create_epic` and `create_issues_from_plan` |
| SECURITY-001 | SECURITY | `GITHUB_TOKEN=""` in subprocess envs |
| SECURITY-002 | SECURITY | Auth failure raises before any issues created |
| COMPAT-005 | COMPATIBILITY | `pytest tests/` passes |
| COMPAT-006 | COMPATIBILITY | `build_lane_plan_from_epic` unaffected |

---

### task-005: `--gh-issues` CLI flag on `datum lane-plan`

| Property ID | Category | Predicate |
|---|---|---|
| SAFETY-001 | SAFETY | No GH calls when flag absent |
| SAFETY-005 | SAFETY | No partial `lane-plan.json` write on `KeyError` |
| SAFETY-008 | SAFETY | Tests mock `create_epic_with_tasks` at module boundary |
| SAFETY-009 | SAFETY | `GITHUB_TOKEN=""` in all `_gh` calls |
| LIVENESS-005 | LIVENESS | `--gh-issues` produces `#N` IDs and `epic_issue` key |
| INVARIANT-006 | INVARIANT | `validate_lane_plan` passes on `--gh-issues` output |
| INVARIANT-009 | INVARIANT | `depends_on` references remapped to `#N` |
| BOUNDARY-006 | BOUNDARY | Missing `task_id` in `task_map` raises before write |
| ISOLATION-001 | ISOLATION | Absent flag produces local IDs only |
| ORDERING-002 | ORDERING | `lane-plan.json` not written until complete `task_map` available |
| SECURITY-001 | SECURITY | `GITHUB_TOKEN=""` in subprocess envs |
| COMPAT-001 | COMPATIBILITY | Without flag: output identical to current behavior |
| COMPAT-004 | COMPATIBILITY | Downstream files need zero changes for `#N` IDs |
| COMPAT-005 | COMPATIBILITY | `pytest tests/` passes |

---

### task-006: GH lane status sync in `datum-tdd-act`

| Property ID | Category | Predicate |
|---|---|---|
| SAFETY-006 | SAFETY | GH sync failure does not abort pipeline |
| SAFETY-008 | SAFETY | Tests mock GH I/O |
| SAFETY-009 | SAFETY | `GITHUB_TOKEN=""` in all `_gh` calls |
| LIVENESS-003 | LIVENESS | Completed `#N` lane closes GH issue with `datum-done` |
| LIVENESS-004 | LIVENESS | Failed `#N` lane posts comment with failure reason |
| IDEMPOTENT-003 | IDEMPOTENT | `update_issue_stage('done')` on already-closed issue does not raise |
| ISOLATION-002 | ISOLATION | GH sync failure does not set pipeline `status` |
| ORDERING-003 | ORDERING | GH sync after lane result determined |
| SECURITY-001 | SECURITY | `GITHUB_TOKEN=""` in subprocess envs |
| SECURITY-003 | SECURITY | Sync uses `datum gh-sync-lane`, not raw `gh` |
| OBSERVABILITY-001 | OBSERVABILITY | GH sync failure printed to stderr |
| OBSERVABILITY-002 | OBSERVABILITY | `update_issue_stage('done')` posts comment + closes + labels |
| OBSERVABILITY-003 | OBSERVABILITY | Failure comment contains verbatim failure reason |
| OBSERVABILITY-004 | OBSERVABILITY | `datum gh-sync-lane` exits 0 on GH API failure |
| COMPAT-005 | COMPATIBILITY | `pytest tests/` passes |
