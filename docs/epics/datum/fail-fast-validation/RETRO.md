# Retrospective — Fail-Fast Deterministic Validation Before Tests

**Run ID:** 20260614-141951  
**Epic:** `fail-fast-validation`  
**Closed:** 2026-06-14  
**Status:** Planning complete. Act phase not executed.

---

## Metrics

| Metric | Value |
|---|---|
| Tasks planned | 3 |
| Tasks completed | 0 |
| Tasks not started | 3 |
| Estimated implementation LOC | 125 (35 + 30 + 60) |
| Actual implementation LOC | 0 |
| Pipeline phases run | 6 (route, awake, refine, plan, properties, review) |
| Pipeline phases skipped | 1 (act) |
| Review findings total | 18 |
| Review findings critical | 2 |
| Review findings high | 8 |
| Review findings medium | 5 |
| Review findings low | 3 |
| Total tokens | 0 (act did not run) |

---

## What Happened

The planning pipeline ran end-to-end and produced high-quality artifacts: a detailed SPEC with 9 requirements and 22 acceptance criteria, a 3-task dependency graph, 24 testable properties, and an 18-finding review report. The act phase was not dispatched in this session. The implementation remains entirely unstarted.

---

## Observations

**What went well:**
- SPEC is thorough and implementation-ready. The insertion point (between line 290 and 299 of `runLane`), failure modes, and non-functional requirements are precisely specified.
- PROPERTIES.md covers all safety invariants (fail-fast ordering, no agent calls on empty implFiles, W-code passthrough) and liveness conditions (retry escalation, pre-check re-run after retry).
- Review caught CORR-010 (critical) at the review phase — the act phase had not run, so no implementation existed to review. This is working as intended: review before merge.
- The 3-task dependency graph is clean: task-1 and task-2 are independent (both write to the same TS file but are serializable), task-3 depends on both.

**What needs improvement:**
- The act phase must run before this epic can be closed as shipped. All 3 tasks are queued.
- File conflict between task-1 and task-2 (both modify `datum-tdd-act-lane.ts`) means they must run sequentially, not in parallel — the lane-plan correctly reflects this via `file_conflict_with`.
- CORR-001 (critical, `detect.py:37`) — Kotlin detection broken — is pre-existing and unrelated to this epic but was surfaced during review. Should be addressed separately.

---

## Defects Found During Review

| ID | Severity | Location | Description |
|---|---|---|---|
| CORR-010 | critical | `datum-tdd-act-lane.ts:290` | Primary deliverable absent — ruff+mypy gate not implemented |
| CORR-001 | critical | `detect.py:37` | Kotlin repos always detected as Java |
| SEC-001 | high | `cli.py:40` | `DATUM_PROJECT_DIR` unvalidated in `os.chdir()` — path traversal |
| PERF-001 | high | `datum-tdd-act-lane.ts:447` | O(n×m) dependency filtering via `Array.includes()` |
| PERF-002 | high | `datum-tdd-act-lane.ts:457` | O(n×m) intra-batch dependency check via `Array.includes()` |
| CORR-002 | high | `detect.py:72` | `lang` loop variable shadows outer `lang` in os.walk fallback |
| CORR-003 | high | `detect.py:153` | uv-vs-pip fallback condition inverted |
| CORR-004 | high | `cli.py:185` | Unguarded `json.loads` crashes datum init on malformed config |
| CORR-005 | high | `cli.py:140` | `link.unlink()` raises `IsADirectoryError` on directory collision |
| CORR-006 | high | `datum-go.ts:106` | No null-guard on `epicBranch` before path interpolation |
| SEC-002 | medium | `cli.py:205` | Branch name unvalidated in filesystem path — path traversal |
| SEC-003 | medium | `cli.py:144` | TOCTOU race in `_install_workflows()` symlink replacement |
| CORR-007 | medium | `detect.py:108` | Raw substring match on package.json text instead of JSON parse |
| CORR-008 | medium | `detect.py:96` | `_detect_python_test_framework` always returns `pytest` |
| CORR-009 | medium | `datum-go.ts:93` | Config-reading agent called unconditionally — missing guard |
| PERF-003 | medium | `datum-tdd-act-lane.ts:75` | Nested `.some()` with `.endsWith()` file ownership check |
| PERF-004 | low | `datum-go.ts:131` | `.slice()` allocations in batch loop |
| SEC-004 | low | `detect.py:158` | Shell-quoting defect in test command fallback echo string |

---

## Next Actions

1. Run `datum act` to execute the 3 queued tasks (task-1, task-2, then task-3 in dependency order).
2. After act completes, run `datum review` to verify the implementation against PROPERTIES.md.
3. Address CORR-001 (critical, Kotlin detection) and SEC-001 (high, path traversal) as separate tickets — both are pre-existing issues surfaced by this review.
4. PERF-001 and PERF-002 are small Set conversions that can be bundled into the next act pass or as a standalone patch.
