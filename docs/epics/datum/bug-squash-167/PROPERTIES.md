# PROPERTIES.md — Bug Squash #167

Derived from SPEC requirements R1–R7 and the seven tasks in TASKS.md.
Every property is a testable predicate. Properties are grouped by category, then
cross-referenced in a traceability table.

---

## 1. SAFETY — what must NEVER happen

**PROPERTY(SAFETY-001):** `make_function_name()` must NEVER return a string containing a hyphen character, regardless of the AC text passed in.

**PROPERTY(SAFETY-002):** `build_lane_plan()` must NEVER produce a lane whose `depends_on` list contains its own lane ID (no self-edges).

**PROPERTY(SAFETY-003):** `build_lane_plan()` must NEVER produce a lane plan where two lanes that share the same output file have no dependency edge between them (no uncovered file conflict).

**PROPERTY(SAFETY-004):** `skeleton_creator.py` must NEVER call `Path.write_text()` on a pre-existing test file — unconditional overwrite of existing skeleton content is forbidden.

**PROPERTY(SAFETY-005):** `datum-go.js` must NEVER silently complete the Act phase while logging zero lanes (either a non-zero lane count is logged, or an error is thrown — never silent success with 0 lanes).

**PROPERTY(SAFETY-006):** `datum-go.js` must NEVER produce an `ENOENT` error caused by a bare relative `scriptPath` string when the process CWD is not the repo root.

**PROPERTY(SAFETY-007):** `slugify()` in `datum/slug.py` must NEVER be modified by any fix in this ticket — its output format (hyphen-separated) must remain byte-for-byte identical for every existing caller.

**PROPERTY(SAFETY-008):** The diff-context grep pattern in `datum-tdd-act-lane.ts` must NEVER count a diff removal line (starting with `-`) as a new test function.

---

## 2. LIVENESS — what must EVENTUALLY happen

**PROPERTY(LIVENESS-001):** Every Act-phase execution that has a valid, non-empty lane plan MUST eventually log: the path where lane-plan.json was found, the number of lanes detected, and the number of waves.

**PROPERTY(LIVENESS-002):** After calling `build_lane_plan()` on any task set containing shared output files, the resulting lane plan MUST eventually have a `depends_on` edge covering every detected file conflict.

**PROPERTY(LIVENESS-003):** After `build_skeleton()` is called, the destination test file MUST eventually exist and contain at least one `def test_` definition.

**PROPERTY(LIVENESS-004):** After `bash scripts/build-workflows.sh` completes with exit code 0, `skills/datum-go.js` and `skills/datum-tdd-act-lane.js` MUST eventually reflect all TypeScript source changes from task-4 and task-5.

**PROPERTY(LIVENESS-005):** When lane-plan.json is absent at both the primary and fallback paths, the Act phase MUST eventually throw an error (not hang or return silently).

---

## 3. INVARIANT — what must ALWAYS be true

**PROPERTY(INVARIANT-001):** The string returned by `make_function_name()` ALWAYS matches the regex `^[a-zA-Z_][a-zA-Z0-9_]*$` (valid Python identifier) for any AC text input.

**PROPERTY(INVARIANT-002):** For every lane whose `file_conflict_with` dict is non-empty after `build_lane_plan()`, the lane's `depends_on` list ALWAYS includes the lane IDs of all lanes that own the conflicting files.

**PROPERTY(INVARIANT-003):** The `file_conflict_with` field in lane schema ALWAYS remains present and populated for observability (it is not removed as a side effect of adding dependency edges).

**PROPERTY(INVARIANT-004):** After any number of `build_skeleton()` calls targeting the same destination file, the file ALWAYS contains every `def test_*` function from every call — no definition from a prior call is ever absent.

**PROPERTY(INVARIANT-005):** All `scriptPath` values in `datum-go.js` ALWAYS resolve to the same absolute path regardless of the process CWD at the time of invocation.

**PROPERTY(INVARIANT-006):** The diff-context grep pattern in `datum-tdd-act-lane.js` ALWAYS counts `+    def test_` lines (indented, inside class bodies) as new test functions.

**PROPERTY(INVARIANT-007):** `build_file_ownership()` return signature ALWAYS yields a 2-tuple `(ownership, conflicts)` — the function's contract is never changed by this ticket.

**PROPERTY(INVARIANT-008):** Every generated `.js` workflow file ALWAYS begins with the `// @generated` banner after a rebuild.

---

## 4. BOUNDARY — valid input ranges

**PROPERTY(BOUNDARY-001):** `make_function_name()` handles AC text that is the empty string without raising an exception (returns a valid, non-empty identifier or a well-defined fallback).

**PROPERTY(BOUNDARY-002):** `make_function_name()` correctly handles AC text containing only hyphens (e.g. `"---"`) and still returns a valid Python identifier.

**PROPERTY(BOUNDARY-003):** `make_function_name()` correctly handles AC text containing consecutive hyphens (e.g. `"mixed--punctuation"`) and produces no hyphens in the output.

**PROPERTY(BOUNDARY-004):** `build_lane_plan()` with an empty task list (zero tasks) returns a lane plan with zero lanes and zero waves without raising an exception.

**PROPERTY(BOUNDARY-005):** `build_lane_plan()` with exactly two tasks sharing exactly one file produces exactly one dependency edge (not two, not zero).

**PROPERTY(BOUNDARY-006):** `build_skeleton()` targeting a destination file with zero bytes (empty file) appends without inserting a leading blank-line separator (or inserts exactly one blank line — behavior is defined and consistent).

**PROPERTY(BOUNDARY-007):** The updated grep pattern in `datum-tdd-act-lane.ts` matches `def test_` indented by exactly 4 spaces (standard Python class body) and by 8 spaces (nested), but does NOT match `def test_` that appears only in a removal line (`-    def test_`).

**PROPERTY(BOUNDARY-008):** `datum-go.js` Act phase throws when `lanePlan.lanes` is an empty array (length 0) and when `waves` is an empty array (length 0) — both zero-lane cases are guarded.

---

## 5. IDEMPOTENT — what is safe to run twice

**PROPERTY(IDEMPOTENT-001):** Calling `make_function_name()` twice with identical inputs produces identical output both times.

**PROPERTY(IDEMPOTENT-002):** Running `bash scripts/build-workflows.sh` twice in succession produces the same output files (content-identical, modulo timestamps injected by the build tool).

**PROPERTY(IDEMPOTENT-003):** `build_lane_plan()` called twice on the same task set with the same conflicts produces a lane plan with the same set of dependency edges both times (no duplicate edges appended on the second call).

**PROPERTY(IDEMPOTENT-004):** Calling `build_skeleton()` twice on the same destination file results in a file where each `def test_*` function definition appears ONCE per call (the second call appends, it does not deduplicate — but it also does not re-overwrite the first call's content).

---

## 6. ORDERING — order invariants

**PROPERTY(ORDERING-001):** `build_file_ownership()` MUST be called and its `conflicts` return value MUST be captured BEFORE `build_lane_plan()` attempts to add conflict-based dependency edges.

**PROPERTY(ORDERING-002):** In the Act phase of `datum-go.js`, logging of the found path and lane/wave counts MUST occur BEFORE the wave dispatch loop begins.

**PROPERTY(ORDERING-003):** In the Act phase of `datum-go.js`, the lane-count log (0 lanes) MUST occur BEFORE the `'Lane plan has 0 tasks'` throw.

**PROPERTY(ORDERING-004):** TypeScript source files (task-4, task-5) MUST be fully edited and type-correct BEFORE `bash scripts/build-workflows.sh` is executed (task-6 depends on task-4 and task-5).

**PROPERTY(ORDERING-005):** When `build_skeleton()` appends to an existing file, the blank-line separator MUST appear BETWEEN the existing content and the new content — not before the existing content and not after the new content.

---

## 7. ISOLATION — what cannot leak between contexts

**PROPERTY(ISOLATION-001):** The hyphen-to-underscore replacement in `make_function_name()` MUST NOT affect the output of `slugify()` — the fix is applied to the slug AFTER it is returned, not inside `slugify()`.

**PROPERTY(ISOLATION-002):** Conflict-based `depends_on` edges added by `build_lane_plan()` MUST NOT override or remove any `depends_on` edges that were already present from explicit task dependencies — edges are additive only.

**PROPERTY(ISOLATION-003):** The skeleton-append fix MUST NOT affect the `build_impl_stubs()` write path at `skeleton_creator.py:286` — only the three identified test-skeleton write sites (lines 467, 556, 579) are modified.

**PROPERTY(ISOLATION-004):** Absolute path resolution in `datum-go.js` MUST NOT alter the resolved path of any script that was already using an absolute path — only bare relative strings are changed.

**PROPERTY(ISOLATION-005):** The updated grep pattern in `datum-tdd-act-lane.ts` MUST NOT change the count produced for files that contain only top-level (non-indented) `def test_` functions — no regression for the existing style.

---

## 8. PERFORMANCE — latency/throughput/size bounds

**PROPERTY(PERF-001):** `make_function_name()` completes in O(n) time relative to the length of the AC text string — no quadratic string operations introduced by the `.replace()` call.

**PROPERTY(PERF-002):** `build_lane_plan()` conflict-edge insertion completes in O(F × L) time where F is the number of conflicting files and L is the number of lanes — no nested lane-plan rebuilds triggered.

**PROPERTY(PERF-003):** `build_skeleton()` append reads the existing file content exactly once per call site — no repeated reads of the destination file within a single invocation.

**PROPERTY(PERF-004):** `bash scripts/build-workflows.sh` completes within the same wall-clock bounds as before the TS edits (no new compilation steps or dependencies added).

---

## 9. SECURITY — access controls

**PROPERTY(SECURITY-001):** The skeleton-append logic MUST NOT follow symlinks when checking whether the destination file exists — `Path.exists()` behavior on symlinks is acceptable as-is, but no new symlink traversal is introduced.

**PROPERTY(SECURITY-002):** No user-supplied AC text is ever passed to a shell command in `make_function_name()` — the `.replace()` is a pure Python string operation with no subprocess or `eval()` involvement.

**PROPERTY(SECURITY-003):** Absolute path construction in `datum-go.js` uses `path.resolve(__dirname, ...)` or equivalent — no string concatenation of untrusted input into the resolved path.

---

## 10. OBSERVABILITY — what must be logged or measured

**PROPERTY(OBS-001):** When lane-plan.json is NOT found, the error message logged/thrown MUST contain the literal string of the primary path attempted (e.g. `docs/epics/{branch}/lane-plan.json`).

**PROPERTY(OBS-002):** When lane-plan.json is NOT found, the error message logged/thrown MUST also contain the literal string of the fallback path attempted (e.g. `.datum/lane-plan.json`).

**PROPERTY(OBS-003):** When lane-plan.json IS found, the Act phase MUST emit a log line containing: the resolved file path, the integer lane count, and the integer wave count.

**PROPERTY(OBS-004):** When `lanes` is empty or `waves` is empty, the Act phase MUST emit a log line containing the lane count (0) before throwing.

**PROPERTY(OBS-005):** The `file_conflict_with` field populated by `build_lane_plan()` MUST remain in the serialized lane-plan.json output so that downstream tools (and humans) can inspect detected conflicts.

**PROPERTY(OBS-006):** After `build_lane_plan()` adds a conflict-based dependency edge, the edge MUST be visible in the `depends_on` list of the affected lane in the serialized lane plan.

---

## 11. COMPATIBILITY — existing behavior that must be preserved

**PROPERTY(COMPAT-001):** `slugify("hello world")` continues to return `"hello-world"` (hyphen-separated, not underscore-separated) after all fixes are applied.

**PROPERTY(COMPAT-002):** `make_function_name()` with AC text containing no hyphens produces the same output before and after the fix (the `.replace('-', '_')` call on a hyphen-free string is a no-op).

**PROPERTY(COMPAT-003):** `build_file_ownership()` function signature `(tasks) -> (ownership, conflicts)` is unchanged — existing callers that unpack the tuple continue to work.

**PROPERTY(COMPAT-004):** `build_lane_plan()` called without the new `conflicts` parameter (i.e., `conflicts=None`) behaves identically to the pre-fix version — the new parameter is optional with a `None` default that skips conflict-edge insertion.

**PROPERTY(COMPAT-005):** Skeleton write behavior for non-existent destination files is unchanged — the file is created with the skeleton content, no blank-line prefix is prepended.

**PROPERTY(COMPAT-006):** The file-level grep in `datum-tdd-act-lane.ts` (line 237, pattern `"def test_\\|async def test_"`) is verified to be unchanged and already correct — it is not inadvertently altered by the diff-context grep fix.

**PROPERTY(COMPAT-007):** The `lane_schema.py` `file_conflict_with` field definition at line 33 is preserved (not renamed, not removed, not made optional if it was required) by the R3 fix.

**PROPERTY(COMPAT-008):** All existing `pytest` tests pass (no new failures introduced) after all six tasks are complete and the build step has run.

---

## Traceability Table

| Property ID | Category | Predicate (summary) | Task IDs |
|-------------|----------|---------------------|----------|
| SAFETY-001 | SAFETY | `make_function_name()` never returns a string with a hyphen | task-1 |
| SAFETY-002 | SAFETY | `build_lane_plan()` never adds a self-edge in `depends_on` | task-2 |
| SAFETY-003 | SAFETY | No uncovered file conflict in lane plan (shared file always has edge) | task-2 |
| SAFETY-004 | SAFETY | `Path.write_text()` on a pre-existing test file never overwrites content | task-3 |
| SAFETY-005 | SAFETY | Act phase never silently completes with 0 logged lanes | task-4 |
| SAFETY-006 | SAFETY | No `ENOENT` from bare relative `scriptPath` when CWD != repo root | task-5, task-6 |
| SAFETY-007 | SAFETY | `slugify()` output unchanged after all fixes | task-1 |
| SAFETY-008 | SAFETY | Grep never counts diff removal lines as new tests | task-5 |
| LIVENESS-001 | LIVENESS | Act phase eventually logs path, lane count, wave count when plan valid | task-4 |
| LIVENESS-002 | LIVENESS | `build_lane_plan()` eventually adds edge for every file conflict | task-2 |
| LIVENESS-003 | LIVENESS | Dest test file eventually exists with at least one `def test_` after build_skeleton() | task-3 |
| LIVENESS-004 | LIVENESS | Generated JS eventually reflects TS source changes after build | task-6 |
| LIVENESS-005 | LIVENESS | Act phase eventually throws when lane-plan.json absent at both paths | task-4 |
| INVARIANT-001 | INVARIANT | `make_function_name()` always returns a valid Python identifier | task-1 |
| INVARIANT-002 | INVARIANT | `file_conflict_with` non-empty implies `depends_on` edge always present | task-2 |
| INVARIANT-003 | INVARIANT | `file_conflict_with` field always retained in schema output | task-2 |
| INVARIANT-004 | INVARIANT | All `def test_*` from all `build_skeleton()` calls always present in file | task-3 |
| INVARIANT-005 | INVARIANT | `scriptPath` always resolves to same absolute path regardless of CWD | task-5, task-6 |
| INVARIANT-006 | INVARIANT | Diff-context grep always counts indented `def test_` lines | task-5 |
| INVARIANT-007 | INVARIANT | `build_file_ownership()` always returns 2-tuple | task-2 |
| INVARIANT-008 | INVARIANT | Generated `.js` files always begin with `// @generated` banner | task-6 |
| BOUNDARY-001 | BOUNDARY | `make_function_name()` handles empty AC text without exception | task-1 |
| BOUNDARY-002 | BOUNDARY | `make_function_name()` handles AC text of only hyphens | task-1 |
| BOUNDARY-003 | BOUNDARY | `make_function_name()` handles consecutive hyphens | task-1 |
| BOUNDARY-004 | BOUNDARY | `build_lane_plan()` with zero tasks returns empty plan, no exception | task-2 |
| BOUNDARY-005 | BOUNDARY | Two tasks sharing one file → exactly one dependency edge | task-2 |
| BOUNDARY-006 | BOUNDARY | `build_skeleton()` on empty dest file appends with defined separator behavior | task-3 |
| BOUNDARY-007 | BOUNDARY | Updated grep matches 4- and 8-space indented `def test_`, not removal lines | task-5 |
| BOUNDARY-008 | BOUNDARY | Act phase throws on empty `lanes` array AND on empty `waves` array | task-4 |
| IDEMPOTENT-001 | IDEMPOTENT | `make_function_name()` is pure — same input always yields same output | task-1 |
| IDEMPOTENT-002 | IDEMPOTENT | `build-workflows.sh` run twice yields content-identical JS output | task-6 |
| IDEMPOTENT-003 | IDEMPOTENT | `build_lane_plan()` twice on same input → same edges, no duplicates | task-2 |
| IDEMPOTENT-004 | IDEMPOTENT | `build_skeleton()` twice appends (not deduplicates, not overwrites) | task-3 |
| ORDERING-001 | ORDERING | `build_file_ownership()` conflicts captured before `build_lane_plan()` adds edges | task-2 |
| ORDERING-002 | ORDERING | Lane/wave count logged before wave dispatch loop | task-4 |
| ORDERING-003 | ORDERING | Lane count (0) logged before `'Lane plan has 0 tasks'` throw | task-4 |
| ORDERING-004 | ORDERING | TS edits complete before build script runs | task-4, task-5, task-6 |
| ORDERING-005 | ORDERING | Blank-line separator appears between existing and new content | task-3 |
| ISOLATION-001 | ISOLATION | Hyphen replacement in `make_function_name()` does not affect `slugify()` | task-1 |
| ISOLATION-002 | ISOLATION | Conflict edges are additive — explicit `depends_on` edges not removed | task-2 |
| ISOLATION-003 | ISOLATION | Append fix does not touch `build_impl_stubs()` write path (line 286) | task-3 |
| ISOLATION-004 | ISOLATION | Absolute path fix only changes bare relative strings, not existing absolute paths | task-5, task-6 |
| ISOLATION-005 | ISOLATION | Updated grep does not change count for top-level `def test_` files | task-5 |
| PERF-001 | PERFORMANCE | `make_function_name()` runs in O(n) — no quadratic operations | task-1 |
| PERF-002 | PERFORMANCE | Conflict-edge insertion in `build_lane_plan()` is O(F × L) | task-2 |
| PERF-003 | PERFORMANCE | `build_skeleton()` append reads dest file exactly once per call | task-3 |
| PERF-004 | PERFORMANCE | Build script wall-clock time unchanged vs pre-fix baseline | task-6 |
| SECURITY-001 | SECURITY | Append logic does not introduce new symlink traversal | task-3 |
| SECURITY-002 | SECURITY | AC text never passed to shell in `make_function_name()` | task-1 |
| SECURITY-003 | SECURITY | Absolute path uses `path.resolve(__dirname, ...)`, no untrusted string concat | task-5, task-6 |
| OBS-001 | OBSERVABILITY | Error on missing lane plan contains primary path string | task-4 |
| OBS-002 | OBSERVABILITY | Error on missing lane plan contains fallback path string | task-4 |
| OBS-003 | OBSERVABILITY | Success log contains resolved path, lane count, wave count | task-4 |
| OBS-004 | OBSERVABILITY | Zero-lanes log emitted before throw | task-4 |
| OBS-005 | OBSERVABILITY | `file_conflict_with` remains in serialized lane-plan.json | task-2 |
| OBS-006 | OBSERVABILITY | Conflict-based `depends_on` edge visible in serialized lane plan | task-2 |
| COMPAT-001 | COMPATIBILITY | `slugify("hello world")` still returns `"hello-world"` | task-1 |
| COMPAT-002 | COMPATIBILITY | `make_function_name()` with hyphen-free text unchanged | task-1 |
| COMPAT-003 | COMPATIBILITY | `build_file_ownership()` signature `(tasks) -> (ownership, conflicts)` unchanged | task-2 |
| COMPAT-004 | COMPATIBILITY | `build_lane_plan()` without `conflicts` arg behaves as before | task-2 |
| COMPAT-005 | COMPATIBILITY | Skeleton write to non-existent file unchanged (creates file, no prefix) | task-3 |
| COMPAT-006 | COMPATIBILITY | File-level grep (line 237) not inadvertently altered by diff-context fix | task-5 |
| COMPAT-007 | COMPATIBILITY | `file_conflict_with` field in `lane_schema.py:33` not renamed or removed | task-2 |
| COMPAT-008 | COMPATIBILITY | Full `pytest` suite passes after all six tasks complete | task-1, task-2, task-3, task-4, task-5, task-6 |

---

## Per-Task Property Assignments

### task-1 — `make_function_name()` replaces hyphens with underscores

| Property ID | Category | Predicate |
|-------------|----------|-----------|
| SAFETY-001 | SAFETY | Never returns a string with a hyphen |
| SAFETY-007 | SAFETY | `slugify()` output unchanged |
| INVARIANT-001 | INVARIANT | Result always matches `^[a-zA-Z_][a-zA-Z0-9_]*$` |
| BOUNDARY-001 | BOUNDARY | Handles empty AC text without exception |
| BOUNDARY-002 | BOUNDARY | Handles AC text of only hyphens |
| BOUNDARY-003 | BOUNDARY | Handles consecutive hyphens |
| IDEMPOTENT-001 | IDEMPOTENT | Same input → same output (pure function) |
| ISOLATION-001 | ISOLATION | Fix scoped to `make_function_name()`, not `slugify()` |
| PERF-001 | PERFORMANCE | O(n) — no quadratic operations |
| SECURITY-002 | SECURITY | AC text never passed to shell |
| COMPAT-001 | COMPATIBILITY | `slugify("hello world")` still returns `"hello-world"` |
| COMPAT-002 | COMPATIBILITY | Hyphen-free inputs produce unchanged output |
| COMPAT-008 | COMPATIBILITY | Full pytest suite passes |

### task-2 — `build_lane_plan()` converts file conflicts into dependency edges

| Property ID | Category | Predicate |
|-------------|----------|-----------|
| SAFETY-002 | SAFETY | No self-edges in `depends_on` |
| SAFETY-003 | SAFETY | No uncovered file conflict (every shared file has an edge) |
| LIVENESS-002 | LIVENESS | Edge eventually added for every file conflict |
| INVARIANT-002 | INVARIANT | `file_conflict_with` non-empty → `depends_on` edge present |
| INVARIANT-003 | INVARIANT | `file_conflict_with` field retained in output |
| INVARIANT-007 | INVARIANT | `build_file_ownership()` always returns 2-tuple |
| BOUNDARY-004 | BOUNDARY | Zero tasks → empty plan, no exception |
| BOUNDARY-005 | BOUNDARY | Two tasks sharing one file → exactly one edge |
| IDEMPOTENT-003 | IDEMPOTENT | Calling twice produces same edges, no duplicates |
| ORDERING-001 | ORDERING | Conflicts captured before edge insertion |
| ISOLATION-002 | ISOLATION | Conflict edges additive — explicit edges not removed |
| PERF-002 | PERFORMANCE | Edge insertion is O(F × L) |
| OBS-005 | OBSERVABILITY | `file_conflict_with` retained in serialized output |
| OBS-006 | OBSERVABILITY | Edge visible in serialized lane plan |
| COMPAT-003 | COMPATIBILITY | `build_file_ownership()` signature unchanged |
| COMPAT-004 | COMPATIBILITY | Optional `conflicts` param — callers without it unaffected |
| COMPAT-007 | COMPATIBILITY | `file_conflict_with` field in schema not renamed/removed |
| COMPAT-008 | COMPATIBILITY | Full pytest suite passes |

### task-3 — Skeleton creator appends to existing test files

| Property ID | Category | Predicate |
|-------------|----------|-----------|
| SAFETY-004 | SAFETY | Never overwrites pre-existing test file content |
| LIVENESS-003 | LIVENESS | Dest file eventually exists with at least one `def test_` |
| INVARIANT-004 | INVARIANT | All `def test_*` from all calls always present in file |
| BOUNDARY-006 | BOUNDARY | Appending to empty file has defined separator behavior |
| IDEMPOTENT-004 | IDEMPOTENT | Calling twice appends, does not overwrite or deduplicate |
| ORDERING-005 | ORDERING | Blank-line separator between existing and new content |
| ISOLATION-003 | ISOLATION | Only the three test-skeleton write sites modified (not line 286) |
| PERF-003 | PERFORMANCE | Dest file read exactly once per call |
| SECURITY-001 | SECURITY | No new symlink traversal introduced |
| COMPAT-005 | COMPATIBILITY | Non-existent dest → file created normally (unchanged) |
| COMPAT-008 | COMPATIBILITY | Full pytest suite passes |

### task-4 — Act phase logs paths and throws descriptive errors on missing lane plan

| Property ID | Category | Predicate |
|-------------|----------|-----------|
| SAFETY-005 | SAFETY | Never silently completes with 0 logged lanes |
| LIVENESS-001 | LIVENESS | Eventually logs path, lane count, wave count when plan valid |
| LIVENESS-005 | LIVENESS | Eventually throws when lane-plan.json absent at both paths |
| BOUNDARY-008 | BOUNDARY | Throws on empty `lanes` array AND empty `waves` array |
| ORDERING-002 | ORDERING | Path/count logged before wave dispatch |
| ORDERING-003 | ORDERING | Lane count (0) logged before throw |
| ORDERING-004 | ORDERING | TS edit complete before build (dependency on task-6) |
| OBS-001 | OBSERVABILITY | Error contains primary path string |
| OBS-002 | OBSERVABILITY | Error contains fallback path string |
| OBS-003 | OBSERVABILITY | Success log contains path, lane count, wave count |
| OBS-004 | OBSERVABILITY | Zero-lanes log emitted before throw |
| COMPAT-008 | COMPATIBILITY | Full pytest suite passes |

### task-5 — Test-count gate grep matches indented class-based test methods

| Property ID | Category | Predicate |
|-------------|----------|-----------|
| SAFETY-006 | SAFETY | No `ENOENT` from bare relative `scriptPath` (shared with task-6) |
| SAFETY-008 | SAFETY | Grep never counts removal lines as new tests |
| INVARIANT-006 | INVARIANT | Diff-context grep always counts indented `def test_` lines |
| INVARIANT-005 | INVARIANT | `scriptPath` always resolves absolutely (shared with task-6) |
| BOUNDARY-007 | BOUNDARY | Matches 4- and 8-space indent; never matches `-` diff lines |
| ISOLATION-004 | ISOLATION | Only bare relative strings changed (shared with task-6) |
| ISOLATION-005 | ISOLATION | Top-level `def test_` count unchanged (no regression) |
| ORDERING-004 | ORDERING | TS edit complete before build |
| SECURITY-003 | SECURITY | Absolute path uses `path.resolve(__dirname, ...)` (shared with task-6) |
| COMPAT-006 | COMPATIBILITY | File-level grep (line 237) not inadvertently altered |
| COMPAT-008 | COMPATIBILITY | Full pytest suite passes |

### task-6 — Rebuild generated JS from updated TypeScript sources

| Property ID | Category | Predicate |
|-------------|----------|-----------|
| SAFETY-006 | SAFETY | No `ENOENT` from bare relative `scriptPath` after rebuild |
| LIVENESS-004 | LIVENESS | Generated JS eventually reflects TS source changes |
| INVARIANT-005 | INVARIANT | `scriptPath` always resolves absolutely after rebuild |
| INVARIANT-008 | INVARIANT | Generated `.js` files always begin with `// @generated` |
| IDEMPOTENT-002 | IDEMPOTENT | Build script run twice → content-identical JS output |
| ORDERING-004 | ORDERING | Depends on task-4 and task-5 completing first |
| ISOLATION-004 | ISOLATION | Only bare relative strings changed |
| PERF-004 | PERFORMANCE | Build wall-clock time unchanged |
| SECURITY-003 | SECURITY | Absolute path uses `path.resolve(__dirname, ...)` |
| COMPAT-008 | COMPATIBILITY | Full pytest suite passes |
