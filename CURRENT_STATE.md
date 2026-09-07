# datum — Current State

**Branch:** `main` | **Last updated:** 2026-09-07 | **Run:** `20260907-022030`

---

## Shipped

### Integration Lanes 2 (2026-09-07, run 20260907-022030)

Epic `docs/epics/datum/integration-lanes-2/` ("slice 2a — an integration lane runs
RED-only, end to end", per `TICKET.md` commit `2dd8143e`) merged at
`c824e42f03b5cacff0059f533e4d663649d1d1fd`. 9/9 tasks completed
(`task-001`..`task-004`, `task-INT-1`..`task-INT-5`, `say_do_ratio` 1.0, 0
`failed_terminal`) per `docs/epics/datum/integration-lanes-2/tasks.json`.

`git` block for this run reports 53 commits, +4423/-111 LOC (net +4312) across 71
files — from `92f2dd8a` ("feat(plan): a task is a vertical slice; the plan gate warns
plan_not_sliced") through `c824e42f` ("spec(integration-lanes-2): Assumption 5 names the
invariants field the runner actually reads"). Unlike the prior two closeouts, this
range reads as scoped to the epic itself (no unrelated multi-epic commits visible in
the listed range).

Review closed with two operator ACCEPT decisions recorded verbatim in
`docs/epics/datum/integration-lanes-2/REVIEW-RESPONSE.md`:

- **ACCEPT `2a3ee4a4`** (ARCH-001, `datum/integration_invariants.py:150`): "The SPEC's
  literal mechanism (parse invariant ids from acceptance-criteria text at runtime) is
  forbidden by the existing tripwire in `datum-tdd-act-lane.test.ts`: runLane never
  reads criteria text, they travel by file to the stage agents. GREEN diagnosed exactly
  that and stopped (`green_blocked_needs_write`). The invariants field is the smallest
  producer that already exists at synthesis time, one line in `derive_integration_lanes`
  and one allowlist entry in the digest; the derivation logic of slice 1 is untouched.
  Documented in `docs/FLOW.md` Closed ('A plan handed a lane a criterion whose input had
  no producer'). SPEC Assumption 5 will be amended at closeout."
- **ACCEPT `d41bdc38`** (ARCH-002, `datum/gate.py:1123`): "`plan_not_sliced` landed on
  dev (`92f2dd8a`, `c9bccb59`) before this epic branched and reached it through the dev
  history, not through this slice's lanes; the review base is the merge-base with main,
  so dev's own commits appear in the diff (same conflation FLOW.md records for closeout
  statistics, #482). Not a change of this slice; slice 2c still owns turning the warning
  into a halt."

`brief_defects`: none reported. `platform`/`lane_tools`: not reported (`null`/empty in
`closeout-data.json`). `gitnexus_diff`/`solutions`: not reported (`null`).

**Telemetry gap (carried pattern — still open).** `token_metrics.collected` is `false`:
"no state.db at `.datum/runs/20260907-022030/state.db` or `.datum/state.db` (no
producer writes one)" — logged as the sole `collector_warnings` entry this run.
`tasks.per_stage_retries` is `null`. This matches the token-metrics capture gap flagged
in the two prior closeouts (FU-4, run `20260707-173926`; repeated in run
`20260906-163354`) — still unresolved after three consecutive epics.

### Prior State (through 2026-09-06, run `20260906-163354`)

Integration Lanes slice 1 (Properties emits tagged cross-task invariants, Plan
schedules RED-only INT lanes) merged at `ff60e33c56cb2dac886372ffcfc03029e9d737cd`.
That closeout's git-stat base-SHA scoping gap (FU-3, carried from run
`20260707-173926`) does not recur in this run's `closeout-data.json` — see above.

### Prior Sessions (Epics 1–23+, PRs #25–#56, Bug Squash #167; Consumer-First
Build-Order, run `20260707-173926`)

See `docs/epics/datum/integration-lanes/` and git history for `9241846`,
`7be6c6f082cd`, and the `43be12e` era for detail. That closeout's own follow-ups (FU-1
through FU-6, `.datum/runs/20260707-173926/follow-ups.json`) are not confirmed
resolved by anything in this run's `closeout-data.json` and are carried forward below.

---

## What's Next

**Priority 1 — Root-cause the missing `state.db`.** `token_metrics.collected: false`
for three consecutive runs now (`20260707-173926`, `20260906-163354`,
`20260907-022030`). Confirm whether a producer is supposed to write one during Act and,
if so, why it hasn't for any of the last three epics.

**Priority 2 — Carry forward FU-1/FU-2/FU-5/FU-6 from run `20260707-173926`**
(review-finding verification for Consumer-First Build-Order, the un-tracked
36-commit hardening pass, GitNexus live-MCP capture, R1–R10 verification) — nothing in
this run's data confirms these were addressed.

**Priority 3 — slice 2c** owns turning `plan_not_sliced` from a warning into a halt
(per ACCEPT `d41bdc38` above, out of scope for this slice).

---

## In Flight

No active feature branches after this closeout. `main` is the merge target
(`c824e42f`).

---

## Backlog

Carried from prior state where unresolved:
- `token_metrics`/`state.db` capture gap — three consecutive runs now (see Priority 1)
- Review-finding verification for Consumer-First Build-Order (FU-1, run
  `20260707-173926`)
- Retroactive mini-closeout for the un-tracked 36-commit hardening pass (FU-2, run
  `20260707-173926`)
- GitNexus MCP live-during-run requirement so `gitnexus_diff` impact detail populates
  (FU-5, run `20260707-173926`; `gitnexus_diff` is `null` again this run)
- R1–R10 verification, Bug Squash Round 2 (FU-6, run `20260707-173926`)
- slice 2c: turn `plan_not_sliced` into a halt (new this run, ACCEPT `d41bdc38`)
