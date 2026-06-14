# Retro — Bug Squash #167

**Run ID:** 20260614-154341
**Completed:** 2026-06-14
**Epic:** `bug-squash-167`
**Phases completed:** route, awake, refine, plan, properties, review, closeout
**Act phase:** not executed — all 6 tasks queued

---

## Metrics

| Metric | Value |
|---|---|
| Tasks planned | 6 |
| Tasks completed | 0 |
| Tasks failed | 0 |
| Tasks queued (ready to act) | 6 |
| Bugs catalogued | 7 (4 critical, 3 high) |
| Review findings | 10 |
| Critical findings | 2 |
| High findings | 2 |
| Medium findings | 5 |
| Low findings | 1 |
| Total tokens | 0 (act phase not run) |
| Commits this epic | 4 (ticket, review, retro, closeout) |
| Estimated LOC to implement | ~205 (task-1: 30, task-2: 50, task-3: 45, task-4: 40, task-5: 35, task-6: 5) |

---

## What Shipped

No implementation. This epic completed the full planning depth: ticket, spec, task decomposition, properties, and review are committed. The act phase was not triggered.

Artifacts committed:

1. `docs/epics/datum/bug-squash-167/TICKET.md` — 7 bugs structured for act dispatch
2. `docs/epics/datum/bug-squash-167/SPEC.md` — requirements with symbol-level call sites
3. `docs/epics/datum/bug-squash-167/TASKS.md` + `tasks.json` — 6-task plan with dependency graph
4. `docs/epics/datum/bug-squash-167/lane-plan.json` — 6 lanes, topological order, file ownership
5. `docs/epics/datum/bug-squash-167/PROPERTIES.md` — safety + liveness properties per fix
6. `docs/epics/datum/bug-squash-167/REVIEW-REPORT.md` — 10 findings
7. `docs/epics/datum/bug-squash-167/routing.json` — pipeline route

---

## Observations

### Skeleton Completeness Drift (CORR-001, CORR-002)

The most significant finding from the review: preflight packets for the prior `fail-fast-validation` run recorded `skeleton_written=True` for all 6 ACs in both `test_ruff_precheck.py` and `test_mypy_precheck.py`. Only 1 of 6 RED skeletons was actually committed to each file. The pipeline's preflight logging does not verify file contents after writing — it trusts the write call succeeded. A partial write or mid-session interruption goes undetected.

**Pattern:** Trust-without-verify defect. The fix is to count `def test_` + `class Test` in the committed file and compare against the preflight AC count before proceeding past RED.

### Hyphenated Identifiers Persist Despite Fix Ticket

Bug #161 (hyphens in generated function names) was catalogued in this ticket, but existing test files still carry pre-fix hyphenated traceability comments (ARCH-001, ARCH-002, CORR-003, CORR-004). Fixing `make_function_name()` going forward does not retroactively correct existing skeletons. The next review pass must also check for legacy hyphenated references in previously generated files.

### File Overwrite / Append Is a Root Cause, Not a Symptom

ARCH-004 (`dest.write_text()` without existence check in `skeleton_creator.py:467`) is the underlying cause of two separate tickets: #160 (overwrite on multi-lane) and the CORR-001/CORR-002 skeleton-count deficit. A single append-or-create fix in `skeleton_creator.py` unblocks both defects.

### Lane-File Exclusivity Not Enforced at Planning Time

Bug #163 (same impl file assigned to multiple lanes) was identified in the ticket. The review confirms ARCH-005: the coupling is in the plan→skeleton handoff, not just the skeleton writer. `plan-decompose` outputs tasks, `lane-plan.json` assigns lanes, and `skeleton-creator` consumes without cross-lane file awareness. The fix must live at lane-plan generation time (exclusive assignment via dependency edge) rather than being patched in the skeleton layer.

### Task-3 File Conflict with Task-1

`lane-plan.json` records `file_conflict_with: {"datum/skeleton_creator.py": "task-1"}` for task-3. Both tasks touch `skeleton_creator.py`. The lane plan retains this for observability but does not enforce sequential execution — task-3 must not be dispatched concurrently with task-1 when the act phase runs.

---

## Defects Found

| ID | Severity | Location | Description |
|---|---|---|---|
| CORR-001 | critical | tests/test_ruff_precheck.py:6 | 5 of 6 RED skeletons absent; preflight falsely logged skeleton_written=True |
| CORR-002 | critical | tests/test_mypy_precheck.py:6 | Same — 5 of 6 RED skeletons absent |
| ARCH-001 | high | tests/test_mypy_precheck.py:3 | Traceability comment uses hyphenated name that doesn't match actual function |
| ARCH-002 | high | tests/test_ruff_precheck.py:3 | Same mismatch |
| ARCH-003 | medium | datum/skeleton_creator.py:337 | make_function_name() no language-aware post-slug sanitization |
| ARCH-004 | medium | datum/skeleton_creator.py:467 | write_text() no existence check — root cause of #160 and skeleton loss |
| ARCH-005 | medium | TICKET.md:14 | #163 reveals tight coupling; fix belongs in plan layer, not skeleton layer |
| CORR-003 | medium | tests/test_ruff_precheck.py:3 | Legacy hyphenated traceability comment not corrected |
| CORR-004 | medium | tests/test_mypy_precheck.py:3 | Same |
| CORR-005 | low | tests/test_ruff_precheck.py:9 | Docstring truncated — missing `, errors: [] }` |

---

## Follow-Ups

See `.datum/runs/20260614-154341/follow-ups.json` for machine-readable gap list.

Key gaps to address before next session:

1. Run `datum act` on `bug-squash-167` — 6 tasks ready, all critical/high priority
2. Dispatch task-3 after task-1 completes (shared file: `datum/skeleton_creator.py`)
3. Add post-skeleton write verification: count `def test_` + `class Test` in committed file vs AC count
4. Fix traceability comments in `tests/test_ruff_precheck.py:3` and `tests/test_mypy_precheck.py:3` to use underscore names
5. Complete truncated docstring at `tests/test_ruff_precheck.py:9`
6. After act runs: complete `fail-fast-validation` epic (3 tasks queued, CORR-010 critical)
