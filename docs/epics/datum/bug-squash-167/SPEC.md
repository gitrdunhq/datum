# SPEC — Bug Squash: 7 Pipeline Friction Bugs (#167)

## Summary

Fix 7 confirmed bugs (4 critical, 3 high) that cause the datum pipeline to produce wrong results or block forward progress. Bugs span `datum/skeleton_creator.py`, `datum/lane_plan.py`, `datum/slug.py`, and `skills/datum-go.js`/`datum-tdd-act-lane.js`. No architectural changes — every fix is a targeted correction at the identified call site.

## Context

These bugs were discovered during the 2026-06-14 session and are fully reproduced against the current `main` branch. The pipeline flow they affect is:

```
datum-go.js (Act phase)
  → reads lane-plan.json (built by datum/lane_plan.py → build_lane_plan())
  → dispatches lanes via datum-tdd-act-setup.js / datum-tdd-act-lane.js
    → skeleton_creator.py (build_skeleton / make_function_name)
    → gate.py (test-count grep)
```

Key symbols and their locations:

| Symbol | File | Role |
|--------|------|------|
| `make_function_name()` | `datum/skeleton_creator.py:337-346` | Generates Python/Swift test function names |
| `slugify()` | `datum/slug.py:18` | Produces hyphen-separated slugs (also used by `datum/state.py` for paths) |
| `build_file_ownership()` | `datum/lane_plan.py:109` | Detects file conflicts; return value discarded at line 356 |
| `build_lane_plan()` | `datum/lane_plan.py:250-291` | Sets `file_conflict_with` field but does not add dependency edges |
| `Path.write_text()` callers | `datum/skeleton_creator.py:467,556,579` | Overwrites destination files unconditionally |
| `scriptPath` literals | `skills/datum-go.js:111,121,131,176,180,201,212,217,226,236,246` | All relative strings, break when CWD != repo root |
| grep pattern `def test_` | `skills/datum-tdd-act-lane.js:355,410-412` | Misses indented class-method test definitions |
| Act phase lane detection | `skills/datum-go.js:145-155` | Reads lane-plan.json via agent; error message omits paths tried |

The `file_conflict_with` field is defined in `datum/models/lane_schema.py:33` and written by `build_lane_plan()` but never consumed by `datum-tdd-act-lane.js` (zero grep matches).

## Requirements

### R1 — Act phase logs paths and throws on missing lane plan (#166)

**Files:** `skills/datum-go.js` (Act phase, lines 145-155), `skills/src/datum-go.ts`

**AC-1.1** When lane-plan.json is not found at the primary epic-dir path, the Act phase logs both the primary path and the fallback path before throwing.

**AC-1.2** The thrown error message includes the literal strings of both paths that were tried.

**AC-1.3** If `lanePlan.lanes` is empty or `waves.length === 0`, the Act phase logs the lane count (0) before throwing `'Lane plan has 0 tasks'`.

**AC-1.4** When lane-plan.json is found and has lanes, the Act phase logs: path where it was found, number of lanes detected, number of waves.

**AC-1.5** No silent completion: every Act-phase execution either logs a non-zero lane count or throws — no path produces zero logged lanes without an error.

---

### R2 — `make_function_name()` produces valid Python identifiers (#161)

**Files:** `datum/skeleton_creator.py:337-346`

**AC-2.1** `make_function_name()` replaces all hyphens in the slugified acceptance-criterion text with underscores before interpolating into the function-name string.

**AC-2.2** The resulting function name matches `^[a-zA-Z_][a-zA-Z0-9_]*$` (valid Python identifier) for any AC text input containing hyphens, spaces, or mixed punctuation.

**AC-2.3** `slugify()` in `datum/slug.py` is NOT modified — it continues to produce hyphen-separated slugs for use by `datum/state.py` path generation.

**AC-2.4** A test asserts that `make_function_name("ac1", "when mypy-output has error-lines")` returns a string containing no hyphens and matching the identifier regex.

---

### R3 — Lane plan serializes shared-file conflicts via dependency edges (#163, #159)

**Files:** `datum/lane_plan.py:109,250-291`, `datum/models/lane_schema.py:33`

**AC-3.1** When `build_file_ownership()` detects that file F is claimed by both lane A and lane B, `build_lane_plan()` auto-adds B to A's `depends_on` list (or A to B's, ensuring a consistent tiebreak — first-claimant wins ownership, later claimants depend on the owner).

**AC-3.2** The `conflicts` return value from `build_file_ownership()` is no longer discarded (the `_` at line 356 is replaced with a named variable and consumed to add dependency edges).

**AC-3.3** For any lane with a non-empty `file_conflict_with` dict, that lane's `depends_on` includes all lanes that own the conflicting files.

**AC-3.4** A test asserts: given two tasks that both write `datum/foo.py`, the resulting lane plan has exactly one of the two lanes depending on the other (no lane is its own dependency).

**AC-3.5** The `file_conflict_with` field is retained in the schema for observability but is now always consistent with `depends_on` — if X is in `file_conflict_with`, the lane-dependency edge exists.

---

### R4 — Skeleton creator appends to existing test files (#160)

**Files:** `datum/skeleton_creator.py:467,556,579`

**AC-4.1** At each of the three `Path.write_text()` call sites, if the destination file already exists, the new skeleton content is appended rather than overwriting.

**AC-4.2** When appending, a blank-line separator is inserted between the existing content and the appended content to maintain valid Python file structure.

**AC-4.3** After two skeleton runs targeting the same test file, both sets of test function definitions are present in the file.

**AC-4.4** If the destination file does not exist, behavior is unchanged — the file is created with the skeleton content.

**AC-4.5** A test asserts: running `build_skeleton()` twice on the same dest path results in a file containing both sets of `def test_*` functions.

---

### R5 — `datum-go.js` resolves script paths absolutely (#165)

**Files:** `skills/datum-go.js` (lines 111,121,131,176,180,201,212,217,226,236,246), `skills/src/datum-go.ts`

**AC-5.1** All `scriptPath` values in `datum-go.js` use absolute paths resolved from `__dirname` (or equivalent `import.meta.url`-based resolution) rather than bare relative strings like `'skills/datum-tdd-act-setup.js'`.

**AC-5.2** Running `datum go` from a directory other than the repo root does not produce `ENOENT` errors on script paths.

**AC-5.3** The TypeScript source (`skills/src/datum-go.ts`) is updated first; the generated `datum-go.js` is rebuilt via `bash scripts/build-workflows.sh`.

---

### R6 — Test-count gate counts class-based test methods (#158, #162)

**Files:** `skills/datum-tdd-act-lane.js:355,410-412`, `skills/src/datum-tdd-act-lane.ts`

**AC-6.1** The grep pattern used for test counting matches both `def test_` at line start AND indented `def test_` inside class bodies (i.e., the pattern is not anchored to column 0 or to `^+def test_` in diff context).

**AC-6.2** Tests defined as methods inside a `class TestFoo(unittest.TestCase)` block are counted by the gate.

**AC-6.3** The diff-context grep at line 355 (`grep -c '^+def test_'`) is replaced with a pattern that matches `+    def test_` (with leading spaces) as well as `+def test_`.

**AC-6.4** A test asserts: a Python file containing only `class TestFoo(unittest.TestCase):\n    def test_bar(self): pass` produces a count of 1 (not 0) from the updated grep invocation.

---

### R7 — `file_conflict_with` non-empty triggers dependency edge insertion (#159)

This requirement is merged into R3 (AC-3.3, AC-3.5) since the root cause is the same code path. Tracked separately here for traceability.

**AC-7.1** (Alias of AC-3.3) Any lane whose `file_conflict_with` is non-empty after `build_lane_plan()` has corresponding `depends_on` entries for every lane that owns the conflicting files.

**AC-7.2** `datum-tdd-act-lane.js` does not need to read `file_conflict_with` at runtime — conflict resolution is baked into the lane plan at plan time by `lane_plan.py`.

## Failure Modes

| Failure | Handling |
|---------|----------|
| `lane-plan.json` not found at primary OR fallback path | Throw with explicit message listing both paths tried; do not silently continue |
| `lanes` array is empty or missing | Throw `'Lane plan has 0 tasks'` with logged lane count (0) |
| Slug produced by `slugify()` already underscore-separated | `replace('-', '_')` is idempotent; no change in behavior |
| Dest test file is read-only or on a read-only FS | `Path.write_text()` / append will raise `PermissionError`; propagate, do not swallow |
| Skeleton append produces duplicate function names | Out of scope for this ticket (separate concern); APPEND does not deduplicate |
| Conflict graph has a cycle (A depends on B, B depends on A) | `build_file_ownership()` assigns ownership deterministically (first-claimant wins), so cycles cannot arise from file-conflict edges alone |
| `__dirname` not available in ESM context | Use `path.resolve(new URL(import.meta.url).pathname, '..')` as fallback; confirm at build time |
| Class-based test grep undershoots (file uses both styles) | New pattern counts both; no regression for files using only `def test_` |

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| No new external dependencies (Python) | `slug.py` fix uses only stdlib string methods |
| No new external dependencies (Node) | `datum-go.js` path fix uses Node `path` module (built-in) |
| `ast-grep` not required | Broader grep pattern is the preferred fix for R6 (avoids new binary dep) |
| Backward compatibility of `slugify()` | Function signature and output for all existing callers must be unchanged |
| `build_file_ownership()` contract unchanged | Returns `(ownership, conflicts)` tuple; callers updated to consume both values |
| Generated JS rebuilt after TS edits | `bash scripts/build-workflows.sh` must be run after any `.ts` source change |
| Test suite green after all fixes | `uv run pytest` passes with no new failures |

## Out of Scope

- Refactoring beyond the minimal fix at each identified call site
- Changing the pipeline architecture (wave/lane/gate model)
- Adding new pipeline features
- Fail-fast-validation epic (separate tracked work)
- Deduplication of function names when appending skeleton content
- Cycle detection in the general dependency graph (beyond file-conflict edges)
- Changing the `slugify()` output format (would break URL/path generation in `datum/state.py`)
- ast-grep integration (broader grep is sufficient and avoids a new binary dependency)

## Open Questions

No clarifying questions needed — intent is clear.

> Ambiguity was LOW. The four detected gaps (conflict strategy, error type, grep implementation, script path resolution) have been resolved via the scan results and the stated fix constraints. Assumptions are validated below.

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|-----------|---------------|--------|----------|
| A1 | `lane-plan.json` lives at `epic_dir/.datum/lane-plan.json`; a second fallback path exists (readable from `datum-go.js` line ~145) | Scan confirmed the Act phase reads the file via agent prompt from `epic_dir` path; fallback exists per existing code | confirmed | n/a |
| A2 | Bug #160 is purely a write-mode issue (`write_text` → append); `skeleton_creator.py` assignment logic is correct | Three `Path.write_text()` call sites at lines 467, 556, 579 confirmed; no task-assignment bug found in scan | confirmed | n/a |
| A3 | `lane_schema.py:33` `file_conflict_with` field already exists and the schema supports `depends_on` lists | Scan confirmed field at `datum/models/lane_schema.py:33`; `depends_on` field coexists in the schema | confirmed | n/a |
| A4 | The grep pattern bug is in `datum-tdd-act-lane.js` only; `gate.py` path resolution is correct | Scan found grep at lines 355, 410-412 in `datum-tdd-act-lane.js`; no path-resolution bug reported in gate.py | confirmed | n/a |
| A5 | File-conflict strategy: first-claimant ownership + later-claimant `depends_on` is the correct serialization approach | `build_file_ownership()` already implements first-claimant at line 121; extending to emit dependency edges is the minimal change | confirmed | n/a |
| A6 | All 4 critical bugs are independent and can be fixed in parallel; no strict ordering | Scan shows bugs live in separate files/functions with no shared mutation path | confirmed | n/a |
| A7 | `datum-go.js` is generated from `skills/src/datum-go.ts`; the `.ts` source must be edited, not the `.js` directly | CLAUDE.md explicitly states: "do NOT edit `.js` files directly — edit TypeScript source in `skills/src/`" | confirmed | n/a |
| A8 | `slugify()` callers in `datum/state.py` rely on hyphens; changing `slug.py` would break paths | Scan confirmed `slugify()` used in `datum/state.py` for path generation; fix must be local to `make_function_name()` | confirmed | n/a |
| A9 | Broader grep (not ast-grep) is acceptable for R6 — pattern `'def test_'` without column anchor is sufficient | Ticket says "ast-grep or a broader grep"; NFR says avoid new binary deps; grep solution is preferred | confirmed | n/a |
| A10 | `__dirname` is available in the generated `datum-go.js` (CommonJS output) | Generated `.js` files use CommonJS via `build-workflows.sh`; `__dirname` is available in CJS modules | confirmed | n/a |

## Classification Metadata

```yaml
estimated_files: 6
estimated_loc: 120
clusters_touched:
  - datum/skeleton_creator.py
  - datum/lane_plan.py
  - datum/slug.py (read-only — no changes)
  - datum/models/lane_schema.py
  - skills/src/datum-go.ts
  - skills/src/datum-tdd-act-lane.ts
new_public_api: false
dependency_additions: []
test_files_affected:
  - tests/test_context_skeleton.py
  - tests/test_units.py
  - tests/test_lane_tools_grep.py (new test for R6)
build_step_required: true  # bash scripts/build-workflows.sh after TS edits
```
