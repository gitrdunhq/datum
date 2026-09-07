# Retro — Integration Lanes

**Run:** `20260906-163354` | **Merge SHA:** `ff60e33c56cb2dac886372ffcfc03029e9d737cd` |
**Merge timestamp:** 2026-09-06T18:58:13-06:00 | **Epic number:** unknown
(`closeout-data.json` reports `epic_number: -1`)

## Metrics

| Metric | Value | Source |
|---|---|---|
| Tasks total | 9 | `closeout-data.json` `tasks.total` |
| Tasks completed | 9 | `closeout-data.json` `tasks.completed` |
| Tasks failed (terminal) | 0 | `closeout-data.json` `tasks.failed_terminal` |
| Say/do ratio | 1.0 | `closeout-data.json` `tasks.say_do_ratio` |
| Per-stage retries | not reported (`null`) | `closeout-data.json` `tasks.per_stage_retries` |
| Lanes | 9, all `final_status: completed` (`task-001`..`task-009`) | `closeout-data.json` `lanes` |
| Brief defects | none reported (empty list) | `closeout-data.json` `brief_defects` |
| Platform | not reported (`null`) | `closeout-data.json` `platform` |
| Lane tools | none reported (empty list) | `closeout-data.json` `lane_tools` |
| Token metrics | **not collected** — "no state.db at `.datum/runs/20260906-163354/state.db` or `.datum/state.db` (no producer writes one)" | `closeout-data.json` `token_metrics`, `collector_warnings` |
| GitNexus diff | not reported (`null`) | `closeout-data.json` `gitnexus_diff` |
| Solutions | not reported (`null`) | `closeout-data.json` `solutions` |

`collector_warnings` names exactly one non-running collector this run:
`token_metrics: not collected — no state.db at .datum/runs/20260906-163354/state.db
or .datum/state.db (no producer writes one)`. `platform`, `lane_tools`,
`gitnexus_diff`, and `solutions` are `null`/empty in `closeout-data.json` without an
accompanying `collector_warnings` entry naming why.

**Git-stat scope note.** `closeout-data.json`'s `git` block reports 513 commits,
+51063/-8320 LOC (net +42743) across ~240 files. That range extends well past this
epic — the oldest commit in the reported list is `52655981 fix(datum-go): preflight
tool-check false-positives on non-datum target repos (#378)`, and the list threads
through several unrelated prior epics (hermetic-test-git-fixtures,
stable-epic-identity, and others). This epic's own scope, bounded by its ticket
commit `9e6c7aaf` ("ticket(integration-lanes): slice 1 — Properties emits tagged
cross-task invariants, Plan schedules RED-only INT lanes") through its final
review-accept commit `2b83f804` ("review(integration-lanes): accept ARCH-001"), is
roughly 80 of the 513 listed commits. No per-epic-scoped LOC/file total is available
in `closeout-data.json` — the raw totals above should not be attributed to this epic
alone.

## Review Decisions

Three findings were accepted by the operator, recorded verbatim in
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

No DEFER lines are recorded in `REVIEW-RESPONSE.md`.

## Observations

- The commit log shows four `REVIEW-REPORT.md` iterations within the epic's own
  range (12, 11, 6, 9, then 2 findings, per the "review: REVIEW-REPORT.md (N
  findings)" commit subjects between `9e6c7aaf` and `2b83f804`), converging to the
  3 ACCEPT decisions above with no findings left outstanding at merge.
- All 9 tasks reached `completed` with a 1.0 say/do ratio and zero terminal
  failures — `closeout-data.json` reports no `brief_defects` for this run.
- `token_metrics` is the only collector explicitly flagged as not-run
  (`collector_warnings`); it should not be read as "zero tokens used," only as
  "not measured."
- The git-stat scope conflation noted above repeats a data-quality pattern flagged
  in an earlier closeout's `follow-ups.json` (FU-3, run `20260707-173926`, "git-stat
  base SHA is stale, conflating this epic with the prior epic"). It recurs here at
  larger scale (513 vs. 68 commits) and is filed again in this run's
  `follow-ups.json`.

## Brief Defects

None reported. `closeout-data.json` `brief_defects` is an empty list.
