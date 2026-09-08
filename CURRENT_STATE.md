# datum — Current State

**Branch:** `datum/state-single-source-of-truth` | **Last updated:** 2026-09-07 | **Run:** `20260907-163917`

---

## Shipped

### State single source of truth (2026-09-07, run 20260907-163917)

Epic `docs/epics/datum/state-single-source-of-truth/` ("Unify `.datum/state.json`
readers/writers behind one db-backed accessor") reached merge commit
`14f8be37f7818881829297041dded862a978d4bd` (`epic_number` reported as `-1` in
`closeout-data.json` — no GitHub issue number attached to this run). 26/26 tasks
completed (`say_do_ratio` 1.0, 0 `failed_terminal`) per
`docs/epics/datum/state-single-source-of-truth/tasks.json`
(`task-001`..`task-012`, `task-INT-1`..`task-INT-14`).

`git` block for this run reports 167 commits, +17812/-1537 LOC (net +16275) across
269 files. The collector flags this range itself: `base_sha_fallback: merge-base
with origin/main; statistics may span more than the epic` — this run's commit list
visibly includes prior, already-closed-out epics (`integration-lanes-2`,
`sweep2-closeout`, `sweep3-panel`, `sweep-refine`, `sweep-ts`, `prompt-refactor`,
and others), so the LOC/file totals above are **not** scoped to this epic alone.
Treat them as an upper bound, not this epic's true diff size — this is the same
base-SHA scoping gap named FU-3 in run `20260707-173926` and revisited (but not
fully closed for this run) by commit `617c213b` ("resolve base-sha from the
epic's ticket commit, not just merge-base with main (#482)").

**What the epic actually did**, per `docs/epics/datum/state-single-source-of-truth/SPEC.md`
and `docs/architecture/state-store.md`:

- `datum/state.py`'s db-backed `load_state()`/`save_state()`/`update_state()`
  (`.datum/state.db`, sqlite `kv_state` table) is now the sole canonical live-state
  accessor. `.datum/state.json` as a **live write-through cache** is dropped
  entirely — `save_state()`/`update_state()` no longer write it (task-012,
  decision recorded in `docs/architecture/state-store.md`).
- Seven independent JSON-only implementations migrated onto the canonical
  accessor: `spec_drift_detector.py`, `pr_comment_monitor.py`, `status_render.py`,
  `rollback.py`, `no_diff_guard.py`, `pipeline_scheduler.py` (migrated last,
  behind a before/after equivalence test per task-011), and `path_utils.py`
  (dead `load_state()`/`state_file()` helpers deleted after a fresh caller grep
  found zero callers, task-006).
- Bare-`Path(".datum/state.json")` readers migrated: `report_bug.py`,
  `archive.py` (task-003, task-009 — closeout archive now snapshots live state
  from `state.db` instead of copying `state.json`).
- `datum/migrate.py` retargeted as a **one-shot legacy `state.json` importer**
  (SPEC Requirement 3 option (b), task-007) — it imports a pre-existing legacy
  file into `state.db` once; it is not an ongoing dual-write or schema-migration
  mechanism for a live `state.json`.
- Exactly two permanent, documented exceptions remain outside the canonical
  accessor (task-008): `datum/memory/corpus_sql.py` (read-only SQL `ATTACH` of
  `state.db` for analytics views; its separate raw-file DuckDB view over
  `state.json` was removed) and `datum-tui/data.py` (intentionally avoids
  importing the `datum` package; reads `.datum/state.db` directly via stdlib
  `sqlite3`).
- `datum/closeout/collect_tasks.py`/`collect_token_metrics.py` (FU-4 from run
  `20260707-173926`) now emit an explicit `no_state_available` sentinel instead
  of a bare `null`/exit — visible in this very `closeout-data.json`'s
  `token_metrics` block below (task-010).
- SPEC records a deliberate scope gap: `QUESTIONS.md` Q5 (schema-versioning),
  Q6 (`busy_timeout` locking), and Q7 ("missing db must raise, never return
  `{}}`") were answered but **not** implemented — each conflicts with a SPEC
  Out-of-Scope item or an already-shipped Requirement/AC. `load_state()`
  continues to return `{}` on a missing/empty store; it does not raise. Recorded
  in `docs/architecture/state-store.md` under "Recorded omission" so this isn't
  rediscovered as a surprise later.

Review closed with 5 findings (0 high/critical) in
`docs/epics/datum/state-single-source-of-truth/REVIEW-REPORT.md`: SEC-001
(medium, shell-injection risk in `structuralDeliverableSteps()`'s quoting via
`lane-steps.ts`'s `q()`, which only escapes double-quotes and leaves
`$(...)`/backticks live inside a double-quoted shell string), SEC-002 (low,
`batch.ts` switched to `bash "$__f"` execution, widening SEC-001's blast
radius), CORR-001 (low, scope-creep: TS workflow/agent-type/structural-reviewer
files touched despite SPEC's Out-of-Scope bar on re-architecting lane
execution), CORR-002 (low, scope-creep: `worktree_manager.py`'s reused-lane-branch
rebase fix is unrelated to state-accessor consolidation), CORR-003 (info,
spec-wording gap: Requirement 10's "unchanged behavior before/after" AC has no
actual pre-migration snapshot to A/B against, since the old code path no longer
exists in the tree).

<!-- review-decisions:start -->
No review decisions recorded yet; `datum review-accept` will update this line.
<!-- review-decisions:end -->

`brief_defects`: none reported (empty array). `platform`/`lane_tools`: not
reported (`null`/empty array in `closeout-data.json`). `gitnexus_diff`/
`solutions`: not reported (`null`).

**Telemetry gap — now surfaced explicitly, not resolved.** `token_metrics.status`
is `"no_state_available"`, `collected: false`, reason: "no state.db at
`.datum/runs/20260907-163917/state.db` or `.datum/state.db` (no producer writes
one)" — the sole `collector_warnings` entry this run. This is the same
underlying gap flagged across the last three closeouts (FU-4, run
`20260707-173926`; repeated `20260906-163354`; repeated `20260907-022030`), but
task-010 of this epic changed *how* it's reported: previously this rendered as
a bare `tasks: null`/all-zero block indistinguishable from "collector never
ran"; now it's an explicit, named sentinel. The underlying absence of a
`state.db`-writing producer in the TS Workflow pipeline is **still open** —
this epic's own Out of Scope section explicitly declined to re-architect that
("Not re-architecting how the TS Workflow pipeline tracks lane execution").
`tasks.per_stage_retries` is `null` again this run.

### Prior State (through 2026-09-07, run `20260907-022030`)

Integration Lanes 2 (slice 2a — an integration lane runs RED-only, end to end)
merged at `c824e42f03b5cacff0059f533e4d663649d1d1fd`. That closeout's own
ACCEPT `d41bdc38` deferred turning `plan_not_sliced` into a halt to "slice 2c";
nothing in this run's `closeout-data.json` confirms that landed.

### Prior Sessions (Epics 1–23+, PRs #25–#56, Bug Squash #167; Consumer-First
Build-Order, run `20260707-173926`)

See `docs/epics/datum/integration-lanes/` and git history for `9241846`,
`7be6c6f082cd`, and the `43be12e` era for detail. That closeout's own follow-ups
(FU-1 through FU-6, `.datum/runs/20260707-173926/follow-ups.json`) are not
confirmed resolved by anything in this run's `closeout-data.json` (except FU-4,
addressed by this epic's task-010 above) and are carried forward below.

---

## What's Next

**Priority 1 — Root-cause the missing `state.db` producer.** `token_metrics`
has now failed to collect for four consecutive runs (`20260707-173926`,
`20260906-163354`, `20260907-022030`, `20260907-163917`). This epic made the
absence explicit (task-010) but explicitly declined to fix the root cause (no
TS Workflow producer writes lane/stage/retry telemetry into `state.db`) — that
remains open per this epic's own Out-of-Scope line.

**Priority 2 — Address the two scope-creep review findings (CORR-001,
CORR-002).** Both are low severity and were not blocked at merge, but the
TS workflow/agent-type/structural-reviewer changes and the
`worktree_manager.py` reused-lane-branch rebase fix were flagged as unrelated
to this epic's SPEC and should get their own retroactive review coverage.

**Priority 3 — SEC-001 shell-quoting fix.** `lane-steps.ts`'s `q()` helper only
escapes double-quotes; `structuralDeliverableSteps()` builds shell commands
from task-plan-derived file paths that can contain shell metacharacters
(`$(...)`, backticks). Medium severity, not yet fixed per the review report.

**Priority 4 — Carry forward FU-1/FU-2/FU-5/FU-6 from run `20260707-173926`**
(review-finding verification for Consumer-First Build-Order, the un-tracked
36-commit hardening pass, GitNexus live-MCP capture, R1–R10 verification) —
nothing in this run's data confirms these were addressed.

**Priority 5 — the deliberately-deferred QUESTIONS.md answers.** Q5
(schema-versioning for `state.db`), Q6 (`busy_timeout` locking), and Q7
(missing-db-raises contract change) were answered during refine but explicitly
not implemented — see `docs/architecture/state-store.md`'s "Recorded omission"
section. Any future work on these needs a new, explicitly-scoped change; do not
assume this epic covered them.

---

## In Flight

This closeout ran on branch `datum/state-single-source-of-truth`, not `main`
(`main` is at `2c8016c5`, "docs(flow): close slice 2a, integration-lanes-2").
The merge commit `14f8be37f7818881829297041dded862a978d4bd` recorded in
`closeout-data.json` is reachable from the current branch; whether/when it
lands on `main` is not confirmed by anything in this run's data.

---

## Backlog

Carried from prior state where unresolved:
- `token_metrics`/`state.db` producer gap — four consecutive runs now, sentinel
  now explicit (task-010) but root cause (no TS-pipeline producer) still open
  (see Priority 1)
- SEC-001: `lane-steps.ts` `q()` shell-quoting gap allows `$(...)`/backtick
  expansion in deliverable file paths (see Priority 3)
- SEC-002: `batch.ts`'s `bash "$__f"` execution model widens SEC-001's blast
  radius (fix SEC-001 first)
- CORR-001/CORR-002: scope-creep review findings needing their own review
  coverage (see Priority 2)
- CORR-003: Requirement 10's "unchanged behavior" AC has no real pre-migration
  A/B snapshot (info only, no action required for merge)
- Deferred QUESTIONS.md answers (Q5 schema versioning, Q6 busy_timeout, Q7
  raise-on-missing) — explicitly out of this epic's implemented scope (see
  Priority 5)
- Review-finding verification for Consumer-First Build-Order (FU-1, run
  `20260707-173926`)
- Retroactive mini-closeout for the un-tracked 36-commit hardening pass (FU-2,
  run `20260707-173926`)
- GitNexus MCP live-during-run requirement so `gitnexus_diff` impact detail
  populates (FU-5, run `20260707-173926`; `gitnexus_diff` is `null` again this
  run)
- R1–R10 verification, Bug Squash Round 2 (FU-6, run `20260707-173926`)
- slice 2c: turn `plan_not_sliced` into a halt (carried from run
  `20260907-022030`, ACCEPT `d41bdc38`; not confirmed done)
- git-stat base-SHA scoping still spans multiple epics in this run despite
  commit `617c213b`'s partial fix (see note under "Shipped" above)
