# [Epic] Unify .datum/state.json readers/writers behind one db-backed accessor

## What

`datum/state.py` maintains `.datum/state.db` (sqlite) as its store of record,
plus a JSON write-through cache at `.datum/state.json` "for backwards
compatibility with legacy scripts" (two separate write sites: `save_state()`
and `update_state()`).

That cache is not actually the only writer of `.datum/state.json`. At least
seven other modules each carry their own **independent, ad-hoc**
`STATE_FILE`/`load_state()`/`save_state()` implementation that reads and
writes `.datum/state.json` directly, entirely bypassing `state.db`:

- `datum/spec_drift_detector.py`
- `datum/pr_comment_monitor.py`
- `datum/status_render.py`
- `datum/rollback.py`
- `datum/no_diff_guard.py`
- `datum/pipeline_scheduler.py`
- `datum/migrate.py`
- `datum/path_utils.py` (docstring literally claims to be "SSOT for all path
  resolution", also has its own JSON-only `load_state()`)

Several of these (`rollback.py`, `no_diff_guard.py`, `spec_drift_detector.py`,
`pr_comment_monitor.py`, `migrate.py`) **write** state.json directly. If
`state.py`'s write-through cache is ever removed (or ever falls out of sync)
without migrating these, `state.db` and `state.json` silently diverge and
whichever consumer reads which file determines which "truth" it sees.

`gate.py`, `report_bug.py`, `archive.py`, `gc.py`, and
`datum/memory/corpus_sql.py` additionally read `.datum/state.json` directly
via a bare `Path(".datum/state.json")`, with no shared accessor at all.

## How this was found

Surfaced while root-causing FU-4 from the `consumer-first-build-order` epic's
closeout follow-ups (run `20260707-173926`): `datum closeout`'s
`collect_tasks.py`/`collect_token_metrics.py` collectors read
`.datum/state.json` / `.datum/state.db` expecting the TDD-act lane pipeline
to have populated per-lane stage/retry/token telemetry there — but nothing
in the current TypeScript-based Workflow pipeline (`skills/src/datum-tdd-act*.ts`)
ever calls into `datum/state.py`'s `save_state()`/`update_state()` at all.
`collect_tasks.py` was silently `sys.exit(1)`-ing before writing
`closeout-raw/tasks.json` when no state file existed, which `collate.py`
then rendered as a bare `tasks: null` in `closeout-data.json` —
indistinguishable from "collector never ran."

That specific silent-null bug is a narrow, separately-fixable symptom. This
epic is about the underlying structural problem it exposed: there is no
single source of truth for pipeline state, so any given reader/writer might
be looking at a stale or entirely different copy than another.

## Requirements

- Pick `datum/state.py`'s db-backed `load_state()`/`save_state()`/
  `update_state()` as the one canonical accessor.
- Migrate all 8 independent implementations listed above onto it — remove
  their local `STATE_FILE`/`load_state`/`save_state` definitions.
- Migrate the 5 bare `Path(".datum/state.json")` readers
  (`gate.py`, `report_bug.py`, `archive.py`, `gc.py`, `corpus_sql.py`) onto
  the same accessor.
- Decide and document the fate of `.datum/state.json` itself: either drop it
  entirely (db-only, live reads go through `load_state()`), or keep it
  strictly as a one-shot archival export written at run-archive time
  (`.datum/runs/<run_id>/state.json` snapshots in `rollback.py`/`archive.py`/
  closeout collectors are a different, legitimate use — a point-in-time
  export, not a live-synced cache — and can likely stay as-is).
- Once unified, revisit `collect_tasks.py`/`collect_token_metrics.py`
  (FU-4) to make "no telemetry available" an explicit, visible signal
  instead of a bare `null`/all-zero output indistinguishable from
  "genuinely zero work happened."
- `gate.py` and `pipeline_scheduler.py` are pipeline-critical — changes
  there need real test coverage before/after, not just a mechanical
  find-replace.

## Not This

- Not re-architecting how the TS Workflow pipeline tracks lane
  execution — that's a separate, larger question (whether lane telemetry
  should ever flow into `state.db` at all, or whether closeout should stop
  trying to read it from there).
- Not touching the `.datum/pipeline-state.json` file (a different, already
  branch-scoped, already-correct state file — see `reset_stale_pipeline_state()`
  in `datum/pipeline_state.py`, unrelated to this one).
