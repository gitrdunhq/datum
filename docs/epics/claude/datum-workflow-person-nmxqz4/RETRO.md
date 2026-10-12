# Retro — Workflow runner core (run 20261012-150046)

Merge commit `5db34d5c497e23da23940b1c7fa00415948640db`, 2026-10-12T13:11:11+00:00.
All figures come from `.datum/runs/20261012-150046/closeout-data.json`, the epic
folder and the commit subjects it lists.

## Metrics

| Metric | Value |
|---|---|
| Tasks (this epic) | 20 total, 20 completed, 0 `failed_terminal` |
| `say_do_ratio` | 1.0 |
| Per-stage retries | not collected (`tasks.per_stage_retries` is `null`) |
| Commits | 63 |
| Files touched | 154 |
| LOC | +13139 / -316 (net +12823) |
| Git warnings | none (`git.warnings: []`) |
| Wall clock | first epic commit `cf2134e` 05:02:35 to merge 13:11:11 (2026-10-12 UTC), about 8h09m |
| Review iterations | 3 reports in the log: 30, 29, then 22 findings |
| Final review | 22 unique findings, 1 high/critical |
| Review decisions recorded | CORR-001 only (two ACCEPT lines, keys `f9b971da` and `8ed9e6a1`) |
| Token metrics | not collected (`no_state_available`) |
| Epic number | `-1` (no GitHub issue attached) |

`platform`, `lane_tools`, `gitnexus_diff` and `solutions` are `null` or empty in the
closeout data; nothing is claimed about them. Token totals, per-model and
per-stage numbers are unavailable: `collector_warnings` says there is no
`state.db` and "no producer writes one".

## Observations

- All 20 lanes (`DAT-1`..`DAT-20`) finished `completed`, in the dependency order
  of `tasks.json`: shell seam and runtime config first (DAT-1, DAT-10), the
  `runBatch` conversions (DAT-2..DAT-9), then the runner chain DAT-11 to DAT-19,
  with the collector (DAT-20) off DAT-13.
- Act ran as many small batches (the commit log shows about 15 `act(...)` merge
  commits across run ids `062335`, `063823`, `073527`, `081550`, `093134`,
  `093831`, `103219`, `105537`), most merging one to three lanes. Per-batch
  timing and retry counts are not in the closeout data.
- Three `plan: amend` commits changed lane briefs after planning: `781efd7`
  (DAT-6 to own the source-text pins its change must update), `d180d56` (DAT-3
  and DAT-8 so their RED stages can satisfy their gates), `bfa7f5b` (DAT-9,
  DAT-19, DAT-20). A fourth, `bc60393`, fixed two suite failures surfaced by the
  first epic numbered with DAT ids.
- A large share of the commit log is fixes to datum's own pipeline made while the
  epic ran (gate scans, preflight, batch retries, lint-fix commits, worktree
  regeneration, the integration-lane refusal at the end). The review reports
  call several of these scope creep (CORR-003..CORR-008) because no requirement
  covers them. The operator accepted only the `batch.ts` change (CORR-001).
- The review loop reduced findings from 30 to 29 to 22 over three iterations.
  The high finding was re-keyed between iterations (`f9b971da` to `8ed9e6a1`) and
  accepted twice. Correct handling of re-keyed findings in `review-accept` worked
  but needed a second ACCEPT line.
- Four medium findings remain with no recorded decision: runId path traversal
  (SEC-001), unbounded shell output buffers (PERF-001), shell batches outside the
  semaphores (PERF-002), and the `MetricsOutcome` type missing `invalid`
  (ARCH-001). Review coverage was incomplete by its own account (PERF-005 lists
  the bundle diffs, generated bundles and the semaphore overhead test as not
  reached).
- Observability gap persists: the epic added a `metrics.jsonl` sink and collector
  support, but the closeout still could not collect token metrics because no
  `state.db` producer exists.

## Brief defects

`brief_defects` is an empty array in `closeout-data.json`; the collector reported
none. The plan-amendment commits listed above are the only signal in this run's
data that lane briefs needed correction after planning, and they are not
classified as brief defects by the collector.

## Gaps routed to follow-ups

See `.datum/runs/20261012-150046/follow-ups.json`.
