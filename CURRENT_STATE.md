# datum — Current State

**Branch:** `main` | **Last updated:** 2026-09-06 | **Run:** `20260906-163354`

---

## Shipped

### Integration Lanes (2026-09-06, run 20260906-163354)

Epic ticket `9e6c7aaf` (`docs/epics/datum/integration-lanes/TICKET.md`, "slice 1 —
Properties emits tagged cross-task invariants, Plan schedules RED-only INT lanes")
merged at `ff60e33c56cb2dac886372ffcfc03029e9d737cd`. 9/9 tasks completed
(`task-001`..`task-009`, `say_do_ratio` 1.0, 0 `failed_terminal`) per
`docs/epics/datum/integration-lanes/tasks.json` / `lane-plan.json`.

Four review iterations ran against `docs/epics/datum/integration-lanes/`
(`REVIEW-REPORT.md` commits with 12, 11, 6, 9, and 2 findings across passes), closing
with the operator recording three ACCEPT decisions in
`docs/epics/datum/integration-lanes/REVIEW-RESPONSE.md`:

- **ACCEPT `d3246c28`** (ARCH-003, `datum/gate.py:19`): "Module-level imports of
  `integration_invariants` in `gate.py` are the same pattern as every other gate helper
  import in that file; the coupling is real and intended, and a lazy import would only
  hide an ImportError until the plan gate runs."
- **ACCEPT `cad4e34f`** (CORR-001, `datum/lane_plan_digest.py:56`): "SPEC AC4.1
  conflicts with its own Backward-compatibility row (pre-slice plans must digest
  byte-identically) and with the shipped test
  `test_ac1_properties_path_none_is_byte_identical_to_pre_slice_output`; every
  consumer already treats an absent kind as task (AC4.3, AC9.2), so no default is
  synthesised."
- **ACCEPT `be2382b4`** (ARCH-001, `datum/gate.py:1087`): "The NFR bounds file reads
  (one extra linear pass over PROPERTIES.md and tasks.json), and `gate_plan` does
  exactly that; `derive_integration_lanes` then works in memory on a table of at most
  a few dozen rows. Verifying `depends_on` against the same derivation the planner ran
  is the point: a second grouping implementation in the gate could drift from the
  planner and pass a plan the planner would not have produced."

`brief_defects` reported by the run: none. `platform`/`lane_tools`: not reported
(null/empty in `closeout-data.json`). `gitnexus_diff`/`solutions`: not reported (null).

**Data gap — git-stat scope conflation (carried pattern, see prior closeouts' FU-3).**
`closeout-data.json`'s `git` block reports 513 commits, 51063/-8320 LOC across ~240
files, spanning the full commit list back through many unrelated prior epics
(hermetic-test-git-fixtures, stable-epic-identity, bug-squash work, etc. — the oldest
entry in the reported list is `52655981 fix(datum-go): preflight tool-check
false-positives on non-datum target repos (#378)`). This epic's own scope, by ticket
commit, runs from `9e6c7aaf` ("ticket(integration-lanes): slice 1 …") through
`2b83f804` ("review(integration-lanes): accept ARCH-001") — roughly 80 of the 513
listed commits. The collector appears to capture the full project git log rather than
a range scoped to the prior epic's merge SHA, the same base-SHA resolution gap flagged
as FU-3 in `.datum/runs/20260707-173926/follow-ups.json`. Per-epic LOC/file figures
above should not be read from the raw `git` block without re-scoping to the ticket
commit.

**Telemetry gap (carried pattern).** `token_metrics.collected` is `false`: "no
state.db at `.datum/runs/20260906-163354/state.db` or `.datum/state.db` (no producer
writes one)" — logged as a `collector_warnings` entry. `tasks.per_stage_retries` is
`null`. This matches the token-metrics capture gap flagged in prior closeouts
(FU-4, run `20260707-173926`) — still unresolved.

### Prior State (through 2026-07-07, run `20260707-173926`)

Consumer-First Build-Order and Bug Squash Round 2 epics shipped; see git history for
`9241846` and `7be6c6f082cd` for detail. That closeout's own follow-ups (FU-1 through
FU-6, `.datum/runs/20260707-173926/follow-ups.json`) — review-finding verification,
retroactive mini-closeout for an un-tracked 36-commit hardening pass, git-stat base-SHA
scoping, telemetry capture, GitNexus live-MCP capture, and R1–R10 verification — are
not confirmed resolved by anything in this run's `closeout-data.json` and are carried
forward below.

### Prior Sessions (Epics 1–23+, PRs #25–#56, Bug Squash #167)

23+ epics shipped historically: local LLM pipeline (MLX Gemma/Qwen3), self-healing,
semantic memory, TUI dashboard, full installer, closeout command, and the original
Bug Squash #167 partial pass. See git log for the `43be12e` era for detail.

---

## What's Next

**Priority 1 — Fix the closeout git-stat base-SHA resolution.** This is the third
consecutive closeout whose `git` block spans far more than the epic under review (this
run: 513 commits back to `#378`-era work). Root-cause where the base SHA is chosen in
the closeout collector so future runs scope `git.commits`/`loc_added`/`loc_removed` to
(previous epic's merge SHA)..(this epic's merge SHA).

**Priority 2 — Root-cause the missing `state.db`.** `token_metrics.collected: false`
for this run because no `state.db` exists at either candidate path. Confirm whether a
producer is supposed to write one during Act and, if so, why it didn't for run
`20260906-163354`.

**Priority 3 — Carry forward FU-1/FU-2/FU-5/FU-6 from run `20260707-173926`**
(review-finding verification for Consumer-First Build-Order, the un-tracked
36-commit hardening pass, GitNexus live-MCP capture, R1–R10 verification) — nothing in
this run's data confirms these were addressed.

---

## In Flight

No active feature branches after this closeout. `main` is the merge target
(`ff60e33c`).

---

## Backlog

Carried from prior state where unresolved:
- Closeout git-stat base-SHA scoping (new evidence this run — see Priority 1)
- `token_metrics`/`state.db` capture gap (see Priority 2)
- Review-finding verification for Consumer-First Build-Order (FU-1, run
  `20260707-173926`)
- Retroactive mini-closeout for the un-tracked 36-commit hardening pass (FU-2, run
  `20260707-173926`)
- GitNexus MCP live-during-run requirement so `gitnexus_diff` impact detail populates
  (FU-5, run `20260707-173926`; `gitnexus_diff` is `null` again this run)
- R1–R10 verification, Bug Squash Round 2 (FU-6, run `20260707-173926`)
