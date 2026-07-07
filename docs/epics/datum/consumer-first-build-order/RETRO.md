# RETRO: Consumer-First Build-Order

**Run:** `20260707-173926` | **Merge:** `92418463ba89febf16230897861f40aba3c31d81` | **Date:** 2026-07-07

## Metrics

| Metric | Value |
|---|---|
| Epic scope commits (`ef25421`..`9241846`) | 12 |
| Epic scope files touched | 30 |
| Epic scope LOC added / removed | +1753 / -18 |
| Full closeout-data.json window (`badb2a9b`..`9241846`) | 68 commits, 64 files, +4462/-461 LOC |
| Tasks landed | 5 (`add-context-files-config-default`, `add-upstream-source-context`, `wire-lane-upstream-injection`, `add-cycle-detection`, `datum-plan-buildorder-and-context`) |
| Review passes (this epic) | 1 (`5f50fec`) |
| Findings (this epic's review) | 6 (2 high, 4 medium) |
| Findings confirmed fixed post-review | 0 confirmed in commit log |
| Brief defects logged | 0 |
| Token metrics captured | 0 (not tracked this run — repeat gap) |
| GitNexus diff base → merge | `badb2a9bceb9` → `9241846` |
| GitNexus impact detail | unavailable (MCP not live during run) |

## Observations

- **The epic itself landed cleanly.** All 5 planned tasks (`TASKS.md`) shipped in a
  tight, dependency-ordered sequence (`add-context-files-config-default` and
  `add-cycle-detection` → `datum-plan-buildorder-and-context`; `add-upstream-source-context`
  → `wire-lane-upstream-injection`), matching the plan's own declared dependency graph.
  One inline self-hosted fix (`9241846`) corrected a build break in the just-added
  `context_files` reader (used `node:fs` directly instead of the `agent()` convention)
  — consistent with the standing "fix pipeline inline" practice.
- **Scope-window conflation is a real gap, not just a footnote.** `closeout-data.json`'s
  `git.commits`/`git.files_touched`/LOC stats span all the way back to `badb2a9bceb9` —
  the commit *before* the previous epic (Bug Squash Round 2) even began — rather than
  starting at that epic's merge (`7be6c6f082cd`). This means the base-SHA used for git
  stat capture in this pipeline run is stale/wrong, and the reported 68-commit,
  +4462/-461 LOC figures are not this epic's true footprint (the true footprint is 12
  commits / 30 files / +1753/-18 LOC, `ef25421`..`9241846`).
- **A substantial body of un-closed-out work rode along in that window.** Between
  `7be6c6f082cd` and `ef25421` (this epic's SPEC commit) sit 36 commits of real pipeline
  fixes — auto-repair of lane scope gaps, per-lane `test_command` preflight, RED-stage
  retry-on-no-commit, count-gate crash guards, CLI-flag recovery, worktree branch
  preservation, `pathBoundaryMatch` nested-path handling, `resilientAgent`
  StructuredOutput-crash handling, decompose-tasks protocol-completeness checks, and
  three of its own review passes (12 → 9 → 6 findings). None of this went through
  Refine → Plan → Review → Closeout as its own unit; it is only traceable via commit
  messages, several of which reference issue numbers (#213, #270, #301–#304, #307–#310,
  #315, #319, #325–#327, #331–#335) that were presumably filed but never confirmed
  closed by a closeout run.
- **Review findings have no visible resolution.** The epic's single review pass
  (`5f50fec`) returned 6 findings including one correctness-relevant bug (`ARCH-001`:
  `pathBoundaryMatch()`'s `b.endsWith('/' + a)` branch contradicts its own documented
  one-directional contract, risking false-positive path-ownership matches). The only
  commit after the review is the unrelated `context_files` build fix (`9241846`) — none
  of the 6 findings appear addressed by name in the subsequent commit log.
- **Telemetry capture gap persists.** This is the second consecutive closeout run
  (after `20260707-093851`) where `tasks`, `solutions`, and `token_metrics` shipped
  empty/zero in `closeout-data.json`. What was a one-off anomaly in the prior retro is
  now a pattern worth root-causing rather than re-flagging indefinitely.

## Brief Defects

None logged in `closeout-data.json` (`brief_defects: []`). Given the review-findings and
telemetry gaps above, absence of logged defects should not be read as "no defects" — the
6 open review findings and the un-closed-out intermediate work are real open items that a
defect-tracking mechanism should have surfaced.

## Follow-ups

See `.datum/runs/20260707-173926/follow-ups.json` for machine-readable entries. Summary:

1. Fix the closeout git-stat base-SHA capture so it anchors to the prior epic's merge
   commit, not an older base — this run's window (`badb2a9bceb9`) predates even the
   *previous* epic.
2. Retroactively account for the 36-commit intermediate pipeline-hardening pass
   (`7be6c6f082cd`..`ef25421`) — either a mini-closeout or explicit issue-closure audit.
3. Verify whether the 6 review findings (`PERF-001`, `PERF-002`, `PERF-003`, `ARCH-001`,
   `ARCH-002`, `ARCH-003`) from `REVIEW-REPORT.md` were fixed; `ARCH-001` in particular
   is a correctness bug, not just a style nit, and warrants priority verification.
4. Root-cause the repeat `tasks`/`solutions`/`token_metrics` empty-capture gap in
   `closeout-data.json` (now observed across two consecutive runs).
5. Ensure GitNexus MCP is live during future runs so impact-detail data populates in
   `gitnexus_diff` (carried forward from the prior epic's retro, still unresolved).
6. Confirm R1–R10 completion from Bug Squash Round 2 (carried forward, still
   unresolved).
