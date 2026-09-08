# Retrospective — State Single Source of Truth

Run `20260907-163917` | Merge `14f8be37f7818881829297041dded862a978d4bd` | `epic_number: -1` (no GitHub issue attached to this run's `closeout-data.json`)

## Metrics

| Metric | Value | Source |
|---|---|---|
| Tasks completed | 26 / 26 | `tasks.total`/`tasks.completed`, `closeout-data.json` |
| `say_do_ratio` | 1.0 | `tasks.say_do_ratio` |
| `failed_terminal` | 0 | `tasks.failed_terminal` |
| `per_stage_retries` | not reported (`null`) | `tasks.per_stage_retries` |
| Commits | 167 | `git.commit_count` |
| LOC added / removed / net | +17812 / -1537 / +16275 | `git.loc_added`/`loc_removed`/`loc_net` |
| Files touched | 269 | `git.files_touched` (count) |
| `brief_defects` | 0 (empty array) | `brief_defects` |
| `platform` | not reported (`null`) | `platform` |
| `lane_tools` | not reported (empty array) | `lane_tools` |
| `token_metrics.collected` | `false` | `token_metrics.status`/`collected` |
| `gitnexus_diff` | not reported (`null`) | `gitnexus_diff` |
| `solutions` | not reported (`null`) | `solutions` |

**Important caveat on the git block:** the collector recorded its own warning —
`base_sha_fallback: merge-base with origin/main; statistics may span more than
the epic` — and the 167-commit list visibly includes multiple prior,
already-closed-out epics (`integration-lanes-2`, `sweep2-closeout`,
`sweep3-panel`, `sweep-refine`, `sweep-ts`, `prompt-refactor`, and several
standalone fix/docs commits). The +17812/-1537 LOC and 269-file totals above
are **not** scoped to this epic's own diff; they are an upper bound produced by
a base-SHA that predates this epic's branch point. This is the same class of
gap tracked as FU-3 in run `20260707-173926`, and commit `617c213b`
("resolve base-sha from the epic's ticket commit, not just merge-base with
main (#482)") only partially addresses it — it still recurs in this run's own
`closeout-data.json`.

`tasks.total`/`tasks.completed` (26/26, `task-001`..`task-012` +
`task-INT-1`..`task-INT-14`) are scoped correctly to this epic per the `lanes`
array in `closeout-data.json`, unlike the git stats above.

## What shipped

- `datum/state.py`'s db-backed accessor (`load_state`/`save_state`/
  `update_state`, `.datum/state.db`) is now the sole canonical live-state
  store. `.datum/state.json` as a live write-through cache is dropped
  entirely (decision doc: `docs/architecture/state-store.md`).
- Seven independent JSON-only state implementations and two bare-`Path`
  readers migrated onto the canonical accessor.
- `datum/migrate.py` retargeted as a one-shot legacy `state.json` importer.
- Exactly two permanent, documented exceptions remain outside the accessor:
  `corpus_sql.py` (SQL-queryable need) and `datum-tui/data.py`
  (dependency-avoidance design constraint).
- `collect_tasks.py`/`collect_token_metrics.py` now emit an explicit
  `no_state_available` sentinel instead of a silent `null` — this is visible
  directly in this run's own `closeout-data.json.token_metrics` block, which
  reports `status: "no_state_available"` rather than a bare zero/null.

## Observations

- **The telemetry gap this epic was partly meant to surface is still
  visible in the epic's own closeout.** `token_metrics.collected: false` for
  this run too — task-010 changed the gap from a silent `null` to an explicit
  named sentinel, but did not (and per its SPEC's Out-of-Scope section, was
  never meant to) fix the underlying absence of a `state.db`-writing producer
  in the TS Workflow pipeline. This is the fourth consecutive closeout run
  with this gap (`20260707-173926`, `20260906-163354`, `20260907-022030`,
  `20260907-163917`).
- **Git-stat scoping is a recurring, still-open pattern.** Three closeouts in
  a row now (`20260707-173926` as FU-3, `20260907-022030` reported it as
  absent, this run as present again) show the `git` block's commit/LOC/file
  totals reflecting more than the epic under review when the branch's
  merge-base with `origin/main` sits behind other merged work. The partial
  fix in `617c213b` did not close this for the present run.
- **Review found scope-creep, not correctness defects.** All 5 review
  findings were medium/low/info; 0 high/critical. Two (CORR-001, CORR-002)
  flag work landed in this epic's diff that the epic's own SPEC explicitly
  put out of scope (TS workflow/agent-type/structural-reviewer changes; a
  `worktree_manager.py` rebase fix). Neither blocked merge, but both should
  get independent review coverage since they weren't reviewed against any
  SPEC of their own.
- **A real, if low-severity, security finding shipped unfixed.** SEC-001
  (medium) identifies that `lane-steps.ts`'s `q()` quoting helper does not
  neutralize `$(...)`/backtick shell expansion inside double-quoted arguments,
  and that `structuralDeliverableSteps()` feeds it task-plan-derived file
  paths. This is in code the review findings (CORR-001) already flag as
  outside this epic's SPEC — it shipped as part of that same scope-creep.
- **The epic explicitly declined 3 of its own refine-stage answers.**
  `QUESTIONS.md` Q5 (schema versioning), Q6 (`busy_timeout` locking), and Q7
  (raise-on-missing-db contract) were each answered during refine but
  conflict with SPEC's Out-of-Scope/Failure-Modes text, so none was
  implemented. This is recorded transparently in
  `docs/architecture/state-store.md`'s "Recorded omission" section rather than
  silently dropped — worth noting as a good pattern (deliberate, documented
  scope-narrowing) as much as an open gap.
- **No REVIEW-RESPONSE.md exists for this epic at closeout time.** Unlike the
  `integration-lanes-2` closeout (which recorded two verbatim operator ACCEPT
  decisions), this run has no operator review-response file yet, so
  `CURRENT_STATE.md`'s review-decisions section carries the standard
  not-yet-recorded placeholder pending `datum review-accept`.

## Brief defects

None reported. `closeout-data.json`'s `brief_defects` array is empty for this
run.
