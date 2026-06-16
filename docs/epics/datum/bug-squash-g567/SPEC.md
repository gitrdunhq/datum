# SPEC — Bug Squash Groups 5, 6, 7

## Summary

Fix 10 targeted bugs and refactors across the datum pipeline: lane-plan resolution drift (using stale `lane-plan.json` when `lane-plan-final.json` exists), missing cross-run completion persistence in the TDD act workflow, absent test-file references in the lane-plan, and a formatting fix. Following those, two structural refactors split oversized files (`skeleton_creator.py` at 812 lines, `datum-tdd-act-lane.ts` at 708 lines) into focused single-responsibility modules. All changes are isolated to the datum pipeline; no external systems are affected.

---

## Context

This epic continues the bug-squash batch initiated in `bug-squash-167`. Groups 5–7 address bugs surfaced during live datum pipeline sessions. The work is organized into three dependency waves:

| Wave | Tasks | Gate |
|------|-------|------|
| Wave 1 | task-1, task-2, task-3, task-4, task-5, task-7, task-8 | All foundational work (parallel) |
| Wave 2 | task-6, task-9 | JS/TS rebuilds; blocked until Wave 1 completes |
| Wave 3 | task-10 | E2E verification; blocked until Wave 2 completes |

Key system relationships grounding these requirements:

- **`skills/src/datum-tdd-act.ts`** — TS source that orchestrates lane dispatch and currently only checks `lane-plan.json`. Already has `lane-plan-final.json` fallback logic in TS source (lines 50–65) but the generated `skills/datum-go.js` does not yet reflect it; a rebuild is required.
- **`skills/src/datum-tdd-act-lane.ts`** (708 lines) — Writes lane-state to `.datum/runs/<runId>/lane-state/<taskId>.json` in TS source (lines 150, 174). `datum-tdd-act-setup.ts` has no lane-state logic. `datum-go.js` does not surface the cross-run skip logic.
- **`datum/skeleton_creator.py`** (812 lines) — Monolithic file with `SKELETON_TEMPLATES` (line 96), `KIND_MAP` (line 197), `build_impl_stubs` (line 259), `infer_test_path` (line 356), `infer_module` (line 392), `make_function_name` (line 401), `make_struct_name` (line 413), `build_skeleton` (line 417), `run_preflight` (line 465). External callers: `tests/test_make_function_name.py`, `tests/test_skeleton_append.py`, `datum/cli.py` (subprocess `-m datum.skeleton_creator`).
- **`docs/epics/datum/bug-squash-g567/lane-plan.json`** — task-6 `files[]` currently lists only `skills/datum-go.js` and `skills/datum-tdd-act-lane.js`; no test file references. task-4 and task-5 are already marked `stage: completed`.
- **Generated JS pattern** — `skills/*.js` have `// @generated` banners. Never edit directly; edit TS source then run `scripts/build-workflows.sh`.

---

## Requirements

### R1 — Lane-plan resolution: prefer `lane-plan-final.json` over `lane-plan.json`

**Source**: G5 bugs #232/#237. **Files**: `skills/src/datum-tdd-act.ts`, `tests/test_lane_resolv.py`

**Acceptance Criteria**:

1. When `docs/epics/{epicBranch}/lane-plan-final.json` exists on disk, `datum-tdd-act.ts` loads it as the active lane plan.
2. When `lane-plan-final.json` does not exist, `datum-tdd-act.ts` falls back to `docs/epics/{epicBranch}/lane-plan.json`.
3. An explicitly supplied `a.lanePlanPath` takes priority over both auto-detected paths; the auto-detection logic is not invoked.
4. If neither `lane-plan-final.json` nor `lane-plan.json` is found, the error message names both paths that were tried.
5. `tests/test_lane_resolv.py` exists and contains a test that places a `lane-plan-final.json` fixture and asserts it is loaded before `lane-plan.json` (RED: currently fails because only `lane-plan.json` is checked).

---

### R2 — Cross-run completion persistence (lane-state)

**Source**: G5 bug #246. **Files**: `skills/src/datum-tdd-act-setup.ts`, `skills/src/datum-tdd-act.ts`

**Acceptance Criteria**:

1. After each lane completes, `datum-tdd-act-setup.ts` writes `.datum/runs/<runId>/lane-state/<laneId>.json` containing `{ "task_id": "<id>", "status": "completed", "completed_at": "<ISO 8601>" }`.
2. Before dispatching a lane, `datum-tdd-act.ts` reads `.datum/runs/<runId>/lane-state/<laneId>.json`; if `status === "completed"`, the lane is skipped.
3. On a fresh run (no `.datum/runs/<runId>/lane-state/` directory), all lanes execute — no regression in normal flow.
4. A test creates `.datum/runs/fake-run/lane-state/task-1.json` with `{"status": "completed"}` and asserts that `datum-tdd-act.ts` skips `task-1` (RED: currently fails because no state tracking exists).

---

### R3 — task-6 lane-plan `files[]` must include test file references

**Source**: G5 bugs #211/#247/#248/#252. **Files**: `docs/epics/datum/bug-squash-g567/lane-plan.json`, `tests/datum-go-tests.js`, `tests/test_count_gate.py`, `tests/test_act_phase_logging.py`, `tests/test_grep_test_count.py`

**Acceptance Criteria**:

1. `task-6.files[]` in `docs/epics/datum/bug-squash-g567/lane-plan.json` includes at least one entry whose path matches the pattern `tests/` (a test file reference).
2. `tests/datum-go-tests.js` exists and contains at minimum one assertion-based sanity check for the datum-go workflow (already exists at 14.2K — AC is that it is listed in `task-6.files[]`).
3. `tests/test_count_gate.py` is referenced in `task-6.files[]` (already exists at 4.3K).
4. `tests/test_act_phase_logging.py` and `tests/test_grep_test_count.py` are referenced or present (already exist).
5. A test asserts that `task-6.files` parsed from the JSON contains at least one string starting with `tests/` (RED: currently zero such entries).

---

### R4 — RED prompt off-limits constraint (already completed)

**Source**: G6 bug #230. **Files**: `skills/src/prompts/red.md`, `skills/src/prompts/red-retry.md`, `tests/test_red_off_limits.py`

**Acceptance Criteria**:

1. `red.md` CONSTRAINTS section includes an explicit off-limits file constraint (confirmed present at line 50, referencing `NoOpPermissionService.swift` as example).
2. `tests/test_red_off_limits.py` exists and passes (confirmed present at 1.3K).
3. **Status**: task-4 is marked `stage: completed` in `lane-plan.json`. No additional work required unless regression is detected during task-10 E2E.

---

### R5 — Task-6 RED note: structural grep replaced with execution-based tests (already completed)

**Source**: G6 bugs #233/#254. **Files**: `docs/epics/datum/bug-squash-g567/TASKS.md`, `docs/epics/datum/bug-squash-g567/lane-plan.json`

**Acceptance Criteria**:

1. task-6 RED note in `TASKS.md` requires execution-based tests (pytest subprocess or `node -e`) rather than raw grep assertions.
2. `tests/test_grep_test_count.py` and `tests/test_count_gate.py` use Python subprocess/pytest assertions (confirmed), satisfying this requirement.
3. **Status**: task-5 is marked `stage: completed` in `lane-plan.json`. No additional work required.

---

### R6 — Rebuild generated JS after Wave 1 fixes (task-6 build step)

**Source**: G5+G6 integration. **Files**: `skills/datum-go.js`, `skills/datum-tdd-act-lane.js`

**Acceptance Criteria**:

1. `bash scripts/build-workflows.sh` exits with code 0.
2. `skills/datum-go.js` contains the lane-plan resolution logic from R1 (checks `lane-plan-final.json` before `lane-plan.json`).
3. `skills/datum-tdd-act-lane.js` reflects the cross-run persistence logic from R2.
4. Both generated files retain `// @generated` banners.
5. **Depends on**: R1 (task-1), R2 (task-2) committed and TypeScript compiled cleanly.

---

### R7 — Fix stray `{{` double-brace in test files

**Source**: G6 bug #254. **Files**: `tests/` (any file containing unescaped `{{` outside template context)

**Acceptance Criteria**:

1. `grep -rc '{{'` across `tests/` returns 0 matches (no stray double-braces outside genuine template placeholders).
2. Strings in actual template definitions (e.g., skeleton templates) that legitimately use `{{` for escaping are not modified.
3. No test regressions introduced by the brace fix.

---

### R8 — Split `skeleton_creator.py` into `datum/skeleton/` package

**Source**: G7 refactoring. **Files**: `datum/skeleton/templates.py`, `datum/skeleton/stubs.py`, `datum/skeleton/inference.py`, `datum/skeleton/create.py`, `datum/skeleton/__init__.py`

**Acceptance Criteria**:

1. `datum/skeleton/templates.py` contains `SKELETON_TEMPLATES` (currently line 96) and `KIND_MAP` (currently line 197).
2. `datum/skeleton/stubs.py` contains `build_impl_stubs()` (currently line 259).
3. `datum/skeleton/inference.py` contains `infer_test_path()` (line 356), `infer_module()` (line 392), `make_function_name()` (line 401), and `make_struct_name()` (line 413).
4. `datum/skeleton/create.py` contains `build_skeleton()` (line 417), `run_preflight()` (line 465), CLI entry, and `main()`.
5. `datum/skeleton/__init__.py` re-exports all symbols currently importable from `datum.skeleton_creator` — specifically: `make_function_name`, `build_skeleton`, `_write_skeleton` (required by `tests/test_make_function_name.py` and `tests/test_skeleton_append.py`).
6. `from datum.skeleton_creator import make_function_name` continues to resolve (backward compat via `__init__.py` shim or `skeleton_creator.py` becomes a thin re-export wrapper).
7. `datum skeleton --task-id task-001 --language python` runs end-to-end without error.
8. `datum/cli.py` subprocess invocation `python -m datum.skeleton_creator` continues to work (either `skeleton_creator.py` remains as shim or `datum/skeleton/create.py` exposes `__main__`).
9. `slugify()` remains untouched in `datum/slug.py`; the wrapper at `skeleton_creator.py:349` is removed after split.
10. All existing tests pass: `uv run pytest tests/test_make_function_name.py tests/test_skeleton_append.py`.

---

### R9 — Split `datum-tdd-act-lane.ts` into `skills/src/datum-tdd-act-lane/` modules

**Source**: G7 refactoring. **Files**: `skills/src/datum-tdd-act-lane/red-prompts.ts`, `skills/src/datum-tdd-act-lane/count-gate.ts`, `skills/src/datum-tdd-act-lane/green-stage.ts`, `skills/src/datum-tdd-act-lane/skeptic-panel.ts`, `skills/src/datum-tdd-act-lane/index.ts`

**Acceptance Criteria**:

1. `skills/src/datum-tdd-act-lane/red-prompts.ts` contains RED agent prompt construction (source lines ~100–250; note: `runRefactor` at line 579 is the REFACTOR stage — naming must reflect actual stage, not the misleading function name).
2. `skills/src/datum-tdd-act-lane/count-gate.ts` contains test-count-gate invocation and parsing logic (source lines ~270–310).
3. `skills/src/datum-tdd-act-lane/green-stage.ts` contains GREEN agent calls, retry logic, and GREEN verification (source lines ~350–450).
4. `skills/src/datum-tdd-act-lane/skeptic-panel.ts` contains `skepticBasePrompt`, `skepticLenses`, and `crossValidateBugs` (source lines ~446–472 / called at lines 539–550).
5. `skills/src/datum-tdd-act-lane/index.ts` contains `runLane` (line 89), `verifyFileOwnership` (line 52), and serves as the DAG scheduler entry point.
6. All imports from `skills/src/datum-tdd-act-lane.ts` resolve through `skills/src/datum-tdd-act-lane/index.ts`.
7. `npx tsc --noEmit` exits 0 (no type errors).
8. No circular imports between the new modules.

---

### R10 — Rebuild generated JS after TS refactoring (final build step)

**Source**: G7 integration. **Files**: `skills/datum-go.js`, `skills/datum-tdd-act-lane.js`

**Acceptance Criteria**:

1. `bash scripts/build-workflows.sh` exits with code 0.
2. `skills/datum-tdd-act-lane.js` is rebuilt from `skills/src/datum-tdd-act-lane/index.ts` as the entrypoint.
3. `skills/datum-go.js` import resolution is updated for the refactored `datum-tdd-act-lane` modules.
4. Both generated files retain `// @generated` banners.
5. **Depends on**: R8 (task-8) and R9 (task-9).

---

## Failure Modes

| Failure | Trigger | Handling |
|---------|---------|----------|
| `lane-plan-final.json` check breaks explicit `a.lanePlanPath` | Resolution logic runs before explicit-path guard | R1-AC3: explicit path must short-circuit auto-detection entirely |
| Lane-state path mismatch (`.datum/lane-state/` vs `.datum/runs/<runId>/lane-state/`) | PLAN.md and TASKS.md disagree on path | TASKS.md is authoritative; use `.datum/runs/<runId>/lane-state/<laneId>.json` |
| `datum.skeleton_creator` backward compat breaks after split | External callers import directly from `datum.skeleton_creator` | `__init__.py` re-exports all public symbols; `cli.py` subprocess path requires `__main__` shim |
| Circular imports in TS module split | Extracted modules import from each other | No module in `datum-tdd-act-lane/` may import from a sibling module at parse time; only `index.ts` orchestrates |
| `build-workflows.sh` fails silently | TS compile error not surfaced | AC requires exit code 0 and banner verification — both are observable gates |
| task-6 `files[]` fix regresses if lane-plan.json is regenerated | Automation overwrites manual fix | Add test (R3-AC5) that asserts the test file entries are present, catching any future overwrite |
| Generated JS diverges from TS source after Wave 2 | Wave 2 task-6 and task-9 rebuild different subsets | task-10 E2E runs full build + test suite to catch divergence |
| `test_lane_resolv.py` missing entirely blocks R1 GREEN | Test file does not exist before task-1 starts | task-1 must create the file in the RED phase before implementation begins |
| `{{` fix changes template-context strings | Grep-and-replace hits legitimate template escapes | R7-AC2: templates with intentional `{{` (e.g., `SKELETON_TEMPLATES`) are excluded from the fix |
| `datum cli.py` subprocess `-m datum.skeleton_creator` fails post-split | `__main__` block moves to `datum/skeleton/create.py` | Either retain thin `skeleton_creator.py` shim or add `if __name__ == "__main__"` to `create.py` and update `cli.py` call |

---

## Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| No behavior changes in refactoring tasks | R8, R9: pure structural moves — no logic alterations; verified by existing tests passing unchanged |
| Build script must be idempotent | `scripts/build-workflows.sh` can run multiple times without error or diff in output |
| Test execution time | New tests in R1–R3 must complete in < 5 s individually under `uv run pytest` |
| Backward compatibility | All `from datum.skeleton_creator import ...` call sites resolve after split (no silent breakage) |
| TypeScript type safety | `npx tsc --noEmit` must pass after R9 split — zero type errors acceptable regression floor |
| File size cap | New modules produced by R8 and R9 must each be under 500 lines (per DPS-103) |
| Generated JS banner preservation | `// @generated` banner must be present in every rebuild output |
| Lane-state JSON schema | Must include exactly: `task_id` (string), `status` (enum: `"completed"`), `completed_at` (ISO 8601 string) — no additional required fields |

---

## Out of Scope

- Changes to any system outside the datum pipeline (no app code, no infrastructure, no CI config unrelated to datum).
- New datum pipeline features — this epic is corrections and refactoring only.
- Changes to `datum/slug.py` — `slugify()` is read-only for this epic.
- Changes to `datum/cli.py` beyond the minimum needed to preserve the `-m datum.skeleton_creator` subprocess invocation.
- Introducing new public API surface beyond re-exports in `__init__.py` and `index.ts`.
- Performance optimizations to existing pipeline stages.
- Addressing bugs not enumerated in Groups 5, 6, or 7.
- Pushing to remote or opening PRs — local commits only until user explicitly approves.

---

## Open Questions

No clarifying questions needed — intent is clear. Ambiguity level is low. See QUESTIONS.md for minor notation discrepancies flagged for confirmation.

---

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|-----------|---------------|--------|---------|
| A1 | `lane-plan-final.json` fallback logic already exists in `datum-tdd-act.ts` TS source (lines 50–65) but is absent from `datum-go.js` | Codebase scan confirmed TS has it; generated JS does not reflect it | confirmed | n/a |
| A2 | Lane-state path is `.datum/runs/<runId>/lane-state/<laneId>.json` (TASKS.md) not `.datum/lane-state/<id>.json` (PLAN.md header) | TASKS.md research findings (line 182) and lane-plan.json AC (line 67) both specify the runId-scoped path | decided | Q1 |
| A3 | task-4 and task-5 are already complete and require no implementation work | Both marked `stage: completed` in `lane-plan.json`; `red.md` line 50 and `test_red_off_limits.py` confirmed present | confirmed | n/a |
| A4 | `tests/datum-go-tests.js`, `tests/test_count_gate.py`, `tests/test_act_phase_logging.py`, `tests/test_grep_test_count.py` already exist | Codebase scan confirmed all four files present with sizes ≥ 4.2K | confirmed | n/a |
| A5 | `tests/test_lane_resolv.py` does not exist and must be created by task-1 | Scan confirmed: no `.py` file, no `.pyc` — genuinely missing | confirmed | n/a |
| A6 | `datum/skeleton/` directory does not exist and must be created by task-8 | Scan confirmed: `datum/skeleton_creator.py` exists but `datum/skeleton/` package does not | confirmed | n/a |
| A7 | `skills/src/datum-tdd-act-lane/` directory does not exist and must be created by task-9 | Scan confirmed: single-file `datum-tdd-act-lane.ts` exists, subdirectory does not | confirmed | n/a |
| A8 | File splits (R8, R9) are behavior-neutral — no logic changes, only movement | TASKS.md explicitly states "no-op refactoring"; backward compat via `__init__.py` / `index.ts` re-exports | decided | n/a |
| A9 | `scripts/build-workflows.sh` succeeds without additional configuration changes | Script exists and is used in existing pipeline; both output files have `// @generated` banners indicating it has run successfully before | confirmed | n/a |
| A10 | `lane-plan.json` in `bug-squash-g567/` is the single source of truth; `TASKS.md` and `PLAN.md` are human-readable secondary references | `lane-plan.json` drives the TDD act pipeline directly; TASKS.md is derived documentation | decided | Q2 |
| A11 | task-6 in lane-plan.json (the JS rebuild) and task-4 in TASKS.md (an earlier rebuild) are distinct steps separated by wave structure, not duplicates | DAG in TASKS.md lines 13–16 explicitly shows task-4 → task-6 ordering; task-6 depends on task-4 output | confirmed | Q3 |
| A12 | `datum/cli.py` invokes `python -m datum.skeleton_creator` and this must continue to work post-split | Codebase scan confirmed this pattern; either `skeleton_creator.py` becomes a shim or `create.py` exposes `__main__` | confirmed | n/a |
| A13 | lane-plan.json task-8 file path notation (`datum-tdd-act-lane_red_prompts.ts` with underscores) is a notation artifact, not the intended filesystem path | TASKS.md uses slash notation (`datum-tdd-act-lane/red-prompts.ts`), matching the directory-based module split described in R9 | guess | Q4 |

---

## Classification Metadata

```yaml
estimated_files: 20
estimated_loc: 145
clusters_touched:
  - datum/skeleton (Python package — new)
  - skills/src/datum-tdd-act-lane (TS module split — new directory)
  - skills/src (datum-tdd-act.ts, datum-tdd-act-setup.ts)
  - tests (new test_lane_resolv.py, updates to lane-plan.json test refs)
  - docs/epics/datum/bug-squash-g567 (lane-plan.json task-6 fix)
new_public_api:
  - datum.skeleton.__init__ (re-exports all datum.skeleton_creator symbols)
  - skills/src/datum-tdd-act-lane/index.ts (replaces monolithic entry point)
dependency_additions: []
```
