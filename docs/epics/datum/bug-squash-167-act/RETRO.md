# Retro — Bug Squash #167 Act Phase

**Run ID:** 20260614-161954
**Completed:** 2026-06-14
**Epic:** `bug-squash-167-act`
**Phases completed:** setup, act (partial), review
**Act phase:** partially executed — 2 of 6 tasks completed, 1 partial, 3 not started

---

## Metrics

| Metric | Value |
|---|---|
| Tasks planned | 6 |
| Tasks completed | 2 (task-1, task-4) |
| Tasks partial | 1 (task-6 — JS rebuilt without task-5 fix) |
| Tasks not completed | 3 (task-2, task-3, task-5) |
| Tasks failed | 0 |
| Bonus fixes | 1 (phantom phases in datum-tdd-act) |
| Review findings | 0 |
| Critical findings | 0 |
| High findings | 0 |
| Total tokens | 0 (not tracked for this run) |
| Commits this run | 3 (43be12e, a34f8af, ee458a7) |
| Estimated LOC planned | ~205 |
| Estimated LOC shipped | ~50 (task-1: 2 lines, task-4: ~43 lines changed in datum-go.ts) |
| New test files committed | 0 |

---

## What Shipped

### task-1 — `make_function_name()` hyphens (COMPLETED)

`datum/skeleton_creator.py` — 2-line fix: `_slugify(text, max_len=60)` → `_slugify(text, max_len=60).replace("-", "_")`. Docstring updated from "valid identifier fragment" to "valid Python/Swift/Go identifier fragment". Fix is minimal and correct.

### task-4 — Act phase path resolution (COMPLETED)

`skills/src/datum-go.ts` — significant refactor of the Act phase setup:
- Early config read (before phase loop) so `skillPath()` available everywhere
- All `workflow({ scriptPath: 'skills/datum-xxx.js' })` calls converted to `workflow({ scriptPath: sk('datum-xxx') })`
- `parseArgs()` made resilient: issue-number strings (e.g. `#23`) and freetext both accepted
- Debug log line added at Act phase entry
- Fixes `#165` (CWD-relative path ENOENT) and `#164` (arg parse crash on non-JSON input)

### Bonus — Phantom phases removed from datum-tdd-act

`skills/src/datum-tdd-act.ts` — removed 8 lines that duplicated phase display already owned by child workflows (setup, lane, merge, docs, triage). Reduces noise in Act phase output.

---

## What Did Not Ship

### task-2 — Lane plan conflict edges

`datum/lane_plan.py:356` still uses `_` to discard the `conflicts` return value from `build_file_ownership()`. No dependency edges are auto-created for file-sharing lanes. The `file_conflict_with` field in lane-plan.json remains observational only — it does not enforce ordering.

**Root cause of gap:** The batch approach (direct fixes without TDD lane scaffolding) prioritized visibly impactful fixes (scriptPath, hyphens). task-2 requires both new logic and a new test file — higher complexity was deferred.

### task-3 — Skeleton append-or-create

`datum/skeleton_creator.py:467,556,579` still call `Path.write_text()` unconditionally. This is the root cause of CORR-001 and CORR-002 (5 of 6 RED skeletons absent from `tests/test_ruff_precheck.py` and `tests/test_mypy_precheck.py`).

**Root cause of gap:** Same as task-2 — deferred due to complexity. Also note: task-3 conflicts with task-1 on `datum/skeleton_creator.py` (file_conflict_with recorded in lane-plan.json) and was intended to run after task-1 completes.

### task-5 — Grep indented test methods

`datum-tdd-act-lane.ts:174` pattern `'^+def test_'` unchanged. Class-based `unittest.TestCase` methods (`    def test_bar(self): pass`) still produce count 0 from the diff-context grep. Gate will reject valid GREEN commits that use class-based test structure.

**Root cause of gap:** Deferred. The JS rebuild (task-6) ran before task-5 was addressed.

---

## Observations

### Batch Fix vs TDD Lane Protocol

All fixes in this run were applied directly without prior RED failing tests. The TDD RED→GREEN→REFACTOR protocol specified in TASKS.md was not followed. No new test files were committed (`tests/test_make_function_name.py`, `tests/test_act_phase_logging.py` are both absent). The shipped fixes appear correct based on code inspection, but lack regression test coverage.

**Impact:** If `make_function_name()` or the `datum-go.ts` scriptPath logic regresses, there is no automated signal. Manual verification only.

### Task-6 Rebuilt Before Task-5 Fixed

The JS rebuild (task-6) ran while task-5 was still open. `skills/datum-tdd-act-lane.js` was rebuilt but only includes the `DEFAULT_CONFIG.skills_dir` addition — the grep fix is absent. This means the generated JS is partially stale relative to what the TS source should become after task-5.

**Correct sequence:** Fix task-5 TS source → rebuild → verify grep pattern in JS.

### File Conflict Not Enforced

Lane-plan records `file_conflict_with: {"datum/skeleton_creator.py": "task-1"}` for task-3. Both task-1 and task-3 touch `datum/skeleton_creator.py`. Since task-2 (conflict edges) was not completed, this conflict is still unenforceable at the plan level. In this run it was a non-issue since task-3 did not run, but future parallel act runs could schedule them concurrently.

### Review Came Back Clean

0 findings from the post-act review (ee458a7). The two completed tasks introduced no new issues. This is consistent with the minimal-diff nature of the fixes.

---

## Defects Found

| ID | Severity | Location | Description |
|---|---|---|---|
| FU-001 | critical | datum/lane_plan.py:356 | Conflict data still discarded — task-2 not completed |
| FU-002 | critical | datum/skeleton_creator.py:467,556,579 | write_text() still overwrites — task-3 not completed; CORR-001/002 persist |
| FU-003 | high | skills/src/datum-tdd-act-lane.ts:174 | Grep pattern unchanged — task-5 not completed |
| FU-004 | high | skills/datum-tdd-act-lane.js | JS rebuilt without task-5 fix — stale relative to intended post-task-5 state |
| FU-005 | high | tests/ | No new test files for tasks 1 or 4 — TDD protocol not followed |
| FU-006 | medium | tests/test_ruff_precheck.py, tests/test_mypy_precheck.py | CORR-001/002 unresolved: 5 of 6 RED skeletons absent per file |

---

## Follow-Ups

See `.datum/runs/20260614-161954/follow-ups.json` for machine-readable gap list.

Key gaps to address before next session:

1. **task-3 first** (highest impact): Fix `Path.write_text()` overwrite at `datum/skeleton_creator.py:467,556,579`. Write `tests/test_skeleton_append.py` (RED) before applying fix. This unblocks CORR-001/002.
2. **task-2**: Fix `datum/lane_plan.py:356` conflict-edge wiring. Write `tests/test_lane_plan_conflicts.py` (RED) first.
3. **task-5**: Fix grep pattern in `datum-tdd-act-lane.ts:174`. Write `tests/test_grep_test_count.py` (RED) first. Then rebuild JS (task-6 completion).
4. **Write missing test files**: `tests/test_make_function_name.py` (task-1 regression) and `tests/test_act_phase_logging.py` (task-4 regression).
5. **Restore CORR-001/002 skeletons**: After task-3 fix, re-run skeleton generation for `tests/test_ruff_precheck.py` AC2-AC6 and `tests/test_mypy_precheck.py` AC2-AC6.
6. **Complete fail-fast-validation epic** (3 tasks queued, CORR-010 critical) — do not start until task-3 skeleton-overwrite fix is in place.
