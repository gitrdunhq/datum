# Retro — Pipeline Infrastructure Session

**Run ID:** 20260614-132742
**Date:** 2026-06-14
**Branch:** main
**Epic:** datum pipeline infrastructure — route, awake, go, review, full TS workflow

---

## Metrics

| Metric | Value |
|---|---|
| Commits | 13 |
| Files touched | ~55 |
| Tasks planned | 6 (gh-issues epic — archived, not executed) |
| Tasks completed | 0 (TDD act did not run) |
| Tasks failed | 0 |
| Review findings | 23 total (7 high/critical) |
| Token total | not instrumented |
| Duration | ~2.5 hours (13:07–13:29 MDT) |

---

## What Shipped

All seven datum pipeline workflows are now compiled TypeScript delivered as self-contained JS bundles:

1. `datum-route` — spec-to-route classifier with model-agnostic tier selection
2. `datum-awake` — codebase distillation + preamble injection
3. `datum-refine` — spec refinement
4. `datum-plan` — decompose + impact + deepen
5. `datum-properties` — property extraction
6. `datum-tdd-act` (+ lane, docs, merge, setup, triage) — TDD execution engine
7. `datum-closeout` — post-merge artifact generation + archiving

The `datum-go` orchestrator wires all seven together in sequence.

---

## Observations

**What went well:**

- Centralized model tiers in `shared/models.ts` — previously scattered across 8+ files. Single change point now.
- Closeout self-archiving works correctly — TASKS.md, lane-plan.json, tasks.json are moved to the epic dir automatically. No more stale root artifacts.
- `parseAgentJson` resilient parsing eliminates a whole class of pipeline panics from slightly malformed agent output.
- Review depth: 23 findings with concrete line numbers and fix suggestions is actionable, not just a list of vague concerns.

**What didn't go well:**

- The gh-issues epic (task-001 through task-006) was planned and TASKS.md written but TDD act never ran — the session pivoted to infrastructure delivery. Tasks are archived as stale.
- Closeout-data.json was never written by the pipeline — the run directory was empty. This retro is reconstructed from git history and artifact evidence.
- Token metrics not instrumented for this session — no per-phase or per-model breakdown available.

**Surprises:**

- The batch partitioning bug (CORR-004) is architectural: datum-go uses sequential index slicing into `topological_order` instead of wave-boundary partitioning. This can produce hangs when a cross-batch dependency is split into the same batch as its consumer.
- SEC-001 (shell injection via ctx.branch) is a real risk, not theoretical — the branch name flows directly into a shell string sent to an agent for execution.

---

## Defects Found During Session

| ID | Severity | Location | Description |
|---|---|---|---|
| SEC-001 | high | `skills/src/datum-closeout.ts:57` | `ctx.branch`/`rid` interpolated into shell commands without sanitization |
| SEC-002 | high | `skills/src/datum-awake.ts:62` | LLM preamble content interpolated into agent instruction strings |
| CORR-004 | high | `skills/src/datum-go.ts:127` | Batch partitioning ignores DAG wave boundaries — potential hang |
| CORR-007 | medium | `datum/gate.py:740` | Validate gate passes silently when test signal file is missing |
| CORR-001 | high | `datum/github_issues.py:218` | `list_sub_issues` unchecked non-array API response |
| CORR-002 | high | `datum/github_issues.py:247` | `build_lane_plan_from_epic` emits dangling `depends_on` IDs silently |
| CORR-003 | high | `datum/github_issues.py:306` | `update_issue_stage` two separate `if stage == 'done':` blocks |
| ARCH-001 | high | `skills/src/datum-go.ts:90` | Act batch loop inlined — extract to `shared/utils.ts` |

Full findings: `docs/epics/main/REVIEW-REPORT.md`

---

## Next

Active ticket: **Fail-Fast Deterministic Validation Before Tests** (`TICKET.md` at repo root).

Priority fixes from this session:
1. SEC-001 — shell injection in datum-closeout (before any production use)
2. CORR-004 — wave-boundary batch partitioning in datum-go
3. CORR-007 — gate_validate signal-missing silent pass
4. ARCH-001 — extract act batch loop from datum-go to shared/utils.ts
