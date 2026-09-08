# PROPERTIES.md — state-single-source-of-truth

Testable invariants derived from `SPEC.md` (Requirements 1-10, Failure Modes, NFRs, Out of Scope) and `TASKS.md` (task-001..task-012), grouped by category, with traceability to tasks.

## 1. SAFETY — what must never happen

- PROPERTY(SAFETY-001): No module other than `datum/state.py` defines `def load_state` or `def save_state`, except the two documented exceptions (`datum/migrate.py`'s renamed legacy reader/writer, `datum-tui/data.py`'s own `load_state()`).
- PROPERTY(SAFETY-002): No `STATE_FILE = Path(".datum/state.json")` live-cache assignment exists outside `datum/state.py`, except in `datum/rollback.py`/`datum/archive.py` where it refers only to the archival path `.datum/runs/<run_id>/state.json`.
- PROPERTY(SAFETY-003): `report_bug.py`'s enrichment step never raises when `.datum/state.db` is missing, zero-byte, or corrupt.
- PROPERTY(SAFETY-004): `datum/gate.py` and `datum/gc.py` receive no state-accessor-motivated diff hunks; `gc.py`'s only permitted change is the `_PROTECTED_NAMES` edit in task-012.
- PROPERTY(SAFETY-005): `load_state()` never raises when `.datum/state.db` is missing or uninitialized; it returns `{}`.
- PROPERTY(SAFETY-006): `update_state()`'s read-modify-write never executes outside a single sqlite `EXCLUSIVE` transaction.
- PROPERTY(SAFETY-007): `collect_tasks.py` never calls `sys.exit(1)` before writing `closeout-raw/tasks.json` when state/lane markers are absent; it writes the `no_state_available` sentinel instead.
- PROPERTY(SAFETY-008): `corpus_sql.py`'s `ATTACH ... state.db` block never becomes a second live writer to `state.db` (read-only attach preserved).

## 2. LIVENESS — what must eventually happen

- PROPERTY(LIVENESS-001): Each of the 7 confirmed independent implementations (`spec_drift_detector.py`, `pr_comment_monitor.py`, `status_render.py`, `rollback.py`, `no_diff_guard.py`, `pipeline_scheduler.py`, `path_utils.py`) eventually resolves its state reads/writes through `datum.state`.
- PROPERTY(LIVENESS-002): `.datum/state.json` is eventually no longer created by `save_state()`/`update_state()` (terminal state after task-012).
- PROPERTY(LIVENESS-003): A rollback operation eventually completes with state written and readable back via `datum.state.load_state()`.
- PROPERTY(LIVENESS-004): `migrate.py`'s legacy import path eventually commits a legacy `state.json`'s contents into `state.db` when one exists and no `state.db` does.
- PROPERTY(LIVENESS-005): Closeout archiving eventually writes `.datum/runs/<run_id>/state.json` derived from `load_state()`, even when state is `{}`.

## 3. INVARIANT — what must always be true

- PROPERTY(INVARIANT-001): `load_state`/`save_state`/`update_state` signatures are unchanged for the whole epic (no breaking signature change).
- PROPERTY(INVARIANT-002): The `kv_state` sqlite table shape (`key TEXT PRIMARY KEY, value TEXT`) and key naming (`"current"`) are unchanged (Out of Scope bars redesign).
- PROPERTY(INVARIANT-003): `docs/architecture/state-store.md` exists once task-001 lands and is the single decision doc every later lane (task-003, task-007, task-012) cites.
- PROPERTY(INVARIANT-004): Exactly two permanent documented "bypass the accessor" exceptions exist after task-008 lands: `corpus_sql.py` and `datum-tui/data.py`; `migrate.py` is the one documented "read legacy json once" exception, distinct from those two.
- PROPERTY(INVARIANT-005): `archive.py`'s copy-then-unlink of the live `.datum/state.db` to `.datum/runs/<run_id>/state.db` is unaffected by the `state.json` changes.
- PROPERTY(INVARIANT-006): The `.archive.done` marker short-circuit (second invocation is a no-op printing `{"ok": true, "skipped": true}`) is unchanged by the read-path swap.

## 4. BOUNDARY — valid input ranges

- PROPERTY(BOUNDARY-001): `load_state()` on a repo with zero state ever written returns exactly `{}` — never `None`, never an exception.
- PROPERTY(BOUNDARY-002): `report_bug.py` enrichment with `.datum/state.db` deleted produces a report payload missing only the state-derived fields, not a crash.
- PROPERTY(BOUNDARY-003): `pipeline_scheduler` given `load_state() == {}` dispatches exactly the lane-plan's root lanes — no more, no fewer — and does not raise.
- PROPERTY(BOUNDARY-004): `archive.py` with no `--run-id` and `load_state()` returning `{}` or lacking a `run_id` key prints the defined JSON error object rather than crashing or hanging.

## 5. IDEMPOTENT — what is safe to run twice

- PROPERTY(IDEMPOTENT-001): Re-invoking closeout archive for a `run_id` whose `.archive.done` marker already exists performs zero additional writes and reports `skipped: true`.
- PROPERTY(IDEMPOTENT-002): Calling `save_state({...})` twice with the same dict leaves `state.db`'s `kv_state` row for key `"current"` equivalent to a single call (upsert, no duplicate rows).
- PROPERTY(IDEMPOTENT-003): `gc.py`'s protected-files check run twice never deletes a protected file (`config.toml`, `state.db`, `state.db-shm`, `state.db-wal`) on repeated collection passes.

## 6. ORDERING — order invariants

- PROPERTY(ORDERING-001): task-001 (decision doc) lands before every migration lane (task-002 through task-012), per the dependency graph's fan-in on task-001.
- PROPERTY(ORDERING-002): task-008 (corpus_sql/datum-tui exceptions) lands before task-012 (drop write-through), so `datum-tui/data.py` already reads `state.db` before `state.json` disappears.
- PROPERTY(ORDERING-003): task-004 (rollback migration) lands before task-005 (pr_comment_monitor), since `pr_comment_monitor.py` imports `rollback.py`.
- PROPERTY(ORDERING-004): task-002's `cli.py:11` import edit lands before task-007's `cli.py:849` migrate-command edit, to avoid a `cli.py` merge conflict.
- PROPERTY(ORDERING-005): task-003 (`archive.py` derives `run_id` via `load_state()`) lands before task-006 (deletes `path_utils.current_run_id()`), so `archive.py` never depends on a function about to be removed.
- PROPERTY(ORDERING-006): task-009 (closeout archive reads from `load_state()`) lands before task-012 (drop write-through), so closeout archiving never silently produces empty runs.
- PROPERTY(ORDERING-007): `update_state()`'s `BEGIN EXCLUSIVE` ... `commit()` ordering is preserved across task-012's edit: the read-modify-write stays fully inside the transaction; the removed write-through block sat after `commit()` and stays removed from that position only.

## 7. ISOLATION — what cannot leak between contexts

- PROPERTY(ISOLATION-001): Test fixtures that `monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ...)` must be set before any `save_state`/`update_state` call in that test, so a real repo's `.datum/` never leaks into a test run (task-004 pitfall).
- PROPERTY(ISOLATION-002): `datum-tui/data.py`'s source contains no `import datum` / `from datum` statement, preserving its no-dependency-on-the-datum-package property.
- PROPERTY(ISOLATION-003): `corpus_sql.py`'s `ATTACH` of `state.db` is read-only and cannot mutate `state.db` as a side effect of an analytics query.
- PROPERTY(ISOLATION-004): `datum.state.load_state()`'s single shared `"current"` dict does not let one migrated module's key overwrite another's key on a plain `save_state(partial_dict)` call — writers that mutate must use `update_state()`, not a naive `save_state()` over the whole dict.

## 8. PERFORMANCE — latency/throughput/size bounds

- PROPERTY(PERFORMANCE-001): Migrated modules' write latency to state does not regress beyond the current `save_state()`/`update_state()` baseline (no added network calls).
- PROPERTY(PERFORMANCE-002): `update_state()` retains exactly one sqlite `EXCLUSIVE` transaction per call (no added round trips) throughout the migration.
- PROPERTY(PERFORMANCE-003): Removing the JSON write-through in task-012 does not increase `save_state()`/`update_state()` latency (it removes one I/O write, so it may only decrease it).

## 9. SECURITY — access controls

- PROPERTY(SECURITY-001): `report_bug.py`'s silent try/except-continue on enrichment failure never surfaces a raw stack trace or unfiltered state contents into the report output.
- PROPERTY(SECURITY-002): `datum-tui/data.py`'s stdlib `sqlite3` read of `state.db` is read-only — it neither creates nor alters `state.db`.
- PROPERTY(SECURITY-003): `corpus_sql.py`'s `ATTACH ... state.db` is explicitly `READ_ONLY`, so `corpus_sql.py` can never become an unintended second writer to `state.db`.

## 10. OBSERVABILITY — what must be logged or measured

- PROPERTY(OBSERVABILITY-001): task-006's re-run grep for `path_utils.load_state`/`state_file`/`current_run_id`/`STATE_FILE` callers is recorded in the commit message, not just run silently.
- PROPERTY(OBSERVABILITY-002): `migrate.py` carries a top-of-file comment stating its decided fate (Requirement 3 option b) so the decision is discoverable without reading the SPEC.
- PROPERTY(OBSERVABILITY-003): `corpus_sql.py` and `datum-tui/data.py` each carry an inline comment citing this epic / `docs/architecture/state-store.md` explaining their bypass.
- PROPERTY(OBSERVABILITY-004): `spec_drift_detector.py`'s and `pipeline_scheduler.py`'s "no confirmed production caller" status is reported in their respective lane summaries (task-005, task-011), not silently fixed or hidden.
- PROPERTY(OBSERVABILITY-005): `closeout-data.json`'s `tasks` field surfaces the `no_state_available` sentinel as a visible, non-null, non-zero value distinguishable from both "ran with zero work" and "collector crashed."

## 11. COMPATIBILITY — existing behavior that must be preserved

- PROPERTY(COMPATIBILITY-001): `tests/test_pr_comment_monitor.py` passes with identical observable behavior before and after migration.
- PROPERTY(COMPATIBILITY-002): `status_render.render(state)`'s output for a given dict is unchanged between the pre- and post-migration read paths.
- PROPERTY(COMPATIBILITY-003): `no_diff_guard`'s pass/block decision for a given state dict is unchanged by migration.
- PROPERTY(COMPATIBILITY-004): `rollback.py`'s written dict shape/keys round-trip match the pre-migration inline `STATE_FILE.write_text(json.dumps(state, indent=2))` output.
- PROPERTY(COMPATIBILITY-005): `pipeline_scheduler`'s dispatch decision is byte-identical pre- and post-migration for the same fixture state.
- PROPERTY(COMPATIBILITY-006): `archive.py`'s "No run_id provided and no state.json found" error message (or a stated updated equivalent) still prints when no `run_id` is resolvable.
- PROPERTY(COMPATIBILITY-007): `corpus_sql.py`'s analytics queries return the same result column names with `state.json` absent as they did when the JSON-backed view existed.
- PROPERTY(COMPATIBILITY-008): `gc.py`'s remaining protected names (`config.toml`, `state.db`, `state.db-shm`, `state.db-wal`) are unaffected by the `state.json` removal.
- PROPERTY(COMPATIBILITY-009): `datum.path_utils.datum_dir`, `skill_root`, and `run_dir` remain importable and behaviorally unchanged after the dead state-helper removal.

---

## Traceability Table

| Property ID | Category | Predicate (summary) | Task IDs |
|---|---|---|---|
| SAFETY-001 | SAFETY | No local `load_state`/`save_state` redefinitions outside exceptions | task-002, task-004, task-005, task-006, task-007, task-008, task-011, task-012 |
| SAFETY-002 | SAFETY | No live-cache `STATE_FILE` outside `state.py` | task-002, task-004, task-005, task-011, task-012 |
| SAFETY-003 | SAFETY | `report_bug` enrichment never raises | task-003 |
| SAFETY-004 | SAFETY | `gate.py`/`gc.py` untouched except protected-names edit | task-012 |
| SAFETY-005 | SAFETY | `load_state()` never raises on missing db | task-001, task-002, task-012 |
| SAFETY-006 | SAFETY | `update_state()` stays single-transaction | task-004, task-012 |
| SAFETY-007 | SAFETY | `collect_tasks.py` writes sentinel instead of exiting | task-010 |
| SAFETY-008 | SAFETY | `corpus_sql.py` ATTACH stays read-only, never a writer | task-008 |
| LIVENESS-001 | LIVENESS | 7 independents eventually migrate | task-002, task-004, task-005, task-006, task-011 |
| LIVENESS-002 | LIVENESS | `state.json` eventually stops being created | task-012 |
| LIVENESS-003 | LIVENESS | Rollback round-trips via canonical accessor | task-004 |
| LIVENESS-004 | LIVENESS | `migrate.py` commits legacy import into `state.db` | task-007 |
| LIVENESS-005 | LIVENESS | Closeout archive writes snapshot from `load_state()` | task-009 |
| INVARIANT-001 | INVARIANT | Canonical accessor signatures unchanged | task-001, task-012 |
| INVARIANT-002 | INVARIANT | `kv_state` schema/key naming unchanged | task-001, task-012 |
| INVARIANT-003 | INVARIANT | Decision doc is the single citation point | task-001, task-003, task-007, task-012 |
| INVARIANT-004 | INVARIANT | Exactly 2 accessor-bypass exceptions + 1 legacy-import exception | task-007, task-008 |
| INVARIANT-005 | INVARIANT | `archive.py` state.db copy+unlink unaffected | task-009 |
| INVARIANT-006 | INVARIANT | `.archive.done` short-circuit unchanged | task-009 |
| BOUNDARY-001 | BOUNDARY | Empty-state `load_state()` returns `{}` | task-001, task-002, task-012 |
| BOUNDARY-002 | BOUNDARY | `report_bug` degrades gracefully on missing db | task-003 |
| BOUNDARY-003 | BOUNDARY | Scheduler dispatches root lanes on empty state | task-011 |
| BOUNDARY-004 | BOUNDARY | `archive.py` prints defined error on unresolved run_id | task-003 |
| IDEMPOTENT-001 | IDEMPOTENT | Re-archiving an already-archived run is a no-op | task-009 |
| IDEMPOTENT-002 | IDEMPOTENT | Double `save_state()` call is upsert-safe | task-012 |
| IDEMPOTENT-003 | IDEMPOTENT | Repeated gc passes never delete protected files | task-012 |
| ORDERING-001 | ORDERING | task-001 precedes all migration lanes | task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 |
| ORDERING-002 | ORDERING | task-008 precedes task-012 | task-008, task-012 |
| ORDERING-003 | ORDERING | task-004 precedes task-005 | task-004, task-005 |
| ORDERING-004 | ORDERING | task-002 precedes task-007 on `cli.py` | task-002, task-007 |
| ORDERING-005 | ORDERING | task-003 precedes task-006 | task-003, task-006 |
| ORDERING-006 | ORDERING | task-009 precedes task-012 | task-009, task-012 |
| ORDERING-007 | ORDERING | Transaction boundary preserved across task-012's edit | task-012 |
| ISOLATION-001 | ISOLATION | `DB_FILE` monkeypatch set before any state call in tests | task-004 |
| ISOLATION-002 | ISOLATION | `datum-tui/data.py` imports no `datum` package | task-008 |
| ISOLATION-003 | ISOLATION | `corpus_sql.py` ATTACH read-only | task-008 |
| ISOLATION-004 | ISOLATION | Shared `"current"` dict keys don't clobber across writers | task-004, task-005 |
| PERFORMANCE-001 | PERFORMANCE | No write-latency regression | task-002, task-003, task-004, task-005, task-007, task-008, task-009, task-011, task-012 |
| PERFORMANCE-002 | PERFORMANCE | Single transaction per `update_state()` call | task-004, task-012 |
| PERFORMANCE-003 | PERFORMANCE | Dropping write-through only improves latency | task-012 |
| SECURITY-001 | SECURITY | `report_bug` failure path leaks nothing extra | task-003 |
| SECURITY-002 | SECURITY | `datum-tui` sqlite3 read is read-only | task-008 |
| SECURITY-003 | SECURITY | `corpus_sql.py` ATTACH is `READ_ONLY` | task-008 |
| OBSERVABILITY-001 | OBSERVABILITY | Fresh grep result recorded in commit message | task-006 |
| OBSERVABILITY-002 | OBSERVABILITY | `migrate.py` top-of-file fate comment | task-007 |
| OBSERVABILITY-003 | OBSERVABILITY | Exception comments in `corpus_sql.py`/`datum-tui/data.py` | task-008 |
| OBSERVABILITY-004 | OBSERVABILITY | Orphan-caller status reported, not hidden | task-005, task-011 |
| OBSERVABILITY-005 | OBSERVABILITY | Sentinel visible in `closeout-data.json` | task-010 |
| COMPATIBILITY-001 | COMPATIBILITY | `test_pr_comment_monitor.py` behavior preserved | task-005 |
| COMPATIBILITY-002 | COMPATIBILITY | `status_render.render()` output unchanged | task-002 |
| COMPATIBILITY-003 | COMPATIBILITY | `no_diff_guard` decision unchanged | task-004 |
| COMPATIBILITY-004 | COMPATIBILITY | `rollback.py` round-trip shape matches pre-migration | task-004 |
| COMPATIBILITY-005 | COMPATIBILITY | `pipeline_scheduler` dispatch byte-identical | task-011 |
| COMPATIBILITY-006 | COMPATIBILITY | `archive.py` error message preserved/updated | task-003 |
| COMPATIBILITY-007 | COMPATIBILITY | `corpus_sql.py` result column names unchanged | task-008 |
| COMPATIBILITY-008 | COMPATIBILITY | `gc.py` remaining protected names unaffected | task-012 |
| COMPATIBILITY-009 | COMPATIBILITY | `path_utils` surviving exports unchanged | task-006 |

---

## Per-Task Property Assignments

- **task-001** (record-state-store-decision): INVARIANT-001, INVARIANT-002, INVARIANT-003, SAFETY-005, BOUNDARY-001, ORDERING-001
- **task-002** (migrate-status-render-to-canonical-accessor): SAFETY-001, SAFETY-002, SAFETY-005, BOUNDARY-001, COMPATIBILITY-002, ORDERING-004, PERFORMANCE-001, LIVENESS-001
- **task-003** (migrate-report-bug-and-archive-readers): SAFETY-003, BOUNDARY-002, BOUNDARY-004, COMPATIBILITY-006, SECURITY-001, ORDERING-005, INVARIANT-003, PERFORMANCE-001
- **task-004** (migrate-rollback-and-no-diff-guard): SAFETY-001, SAFETY-002, SAFETY-006, LIVENESS-003, COMPATIBILITY-003, COMPATIBILITY-004, ISOLATION-001, ISOLATION-004, ORDERING-003, PERFORMANCE-001, PERFORMANCE-002
- **task-005** (migrate-pr-monitor-and-drift-detector): SAFETY-001, LIVENESS-001, COMPATIBILITY-001, ISOLATION-004, ORDERING-003, OBSERVABILITY-004, PERFORMANCE-001
- **task-006** (retire-path-utils-state-helpers): SAFETY-001, LIVENESS-001, COMPATIBILITY-009, OBSERVABILITY-001, ORDERING-005
- **task-007** (retarget-migrate-as-legacy-importer): SAFETY-001, LIVENESS-004, INVARIANT-004, OBSERVABILITY-002, ORDERING-004, PERFORMANCE-001
- **task-008** (document-sql-and-tui-exceptions): SAFETY-001, SAFETY-008, INVARIANT-004, ISOLATION-002, ISOLATION-003, SECURITY-002, SECURITY-003, OBSERVABILITY-003, COMPATIBILITY-007, ORDERING-002, PERFORMANCE-001
- **task-009** (archive-live-state-from-canonical-store): LIVENESS-005, INVARIANT-005, INVARIANT-006, IDEMPOTENT-001, ORDERING-006, PERFORMANCE-001
- **task-010** (closeout-no-state-sentinel): SAFETY-007, OBSERVABILITY-005
- **task-011** (migrate-pipeline-scheduler-with-equivalence-test): SAFETY-001, SAFETY-002, LIVENESS-001, BOUNDARY-003, COMPATIBILITY-005, OBSERVABILITY-004, PERFORMANCE-001
- **task-012** (drop-live-state-json-write-through): SAFETY-002, SAFETY-004, SAFETY-005, SAFETY-006, LIVENESS-002, INVARIANT-001, INVARIANT-002, BOUNDARY-001, IDEMPOTENT-002, IDEMPOTENT-003, ORDERING-002, ORDERING-006, ORDERING-007, PERFORMANCE-002, PERFORMANCE-003, COMPATIBILITY-008

Every task has at least one assigned property; no task is flagged as untestable.

---

## Integration Invariants

| ID | Invariant | Covers | Source |
|---|---|---|---|
| INV-1 | The db-backed accessor (`load_state`/`save_state`/`update_state`) is the single read/write path for live state across every migrated module, with unchanged signatures | task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 | spec:Requirement 1 |
| INV-2 | Each of the 7 migrated modules contains zero local `STATE_FILE`/`load_state`/`save_state` redefinitions post-migration | task-002, task-004, task-005, task-006, task-011 | spec:Requirement 2 |
| INV-3 | `migrate.py`'s fate (one-shot legacy importer) is fixed by task-001's decision doc and implemented unchanged by task-007 | task-001, task-007 | spec:Requirement 3 |
| INV-4 | `report_bug.py` and `archive.py` contain zero live `.datum/state.json` literal reads after migration | task-002, task-003 | spec:Requirement 4 |
| INV-5 | `corpus_sql.py`'s and `datum-tui/data.py`'s documented exceptions both derive their justification from the same task-001 decision doc | task-001, task-008 | spec:Requirement 5 |
| INV-6 | `gc.py`'s protected-names set is updated to match the Requirement-1 decision, and `gate.py`/`gc.py` otherwise remain untouched by accessor migration | task-001, task-012 | spec:Requirement 6 |
| INV-7 | `datum-tui/data.py` remains exempt from importing `datum` but swaps its backing store to `state.db` before task-012 drops the JSON cache it used to read | task-008, task-012 | spec:Requirement 7 |
| INV-8 | task-012's removal of the write-through cache is safe only because every live-cache reader (task-002 through task-011) has already migrated off `state.json` | task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 | spec:Requirement 8 |
| INV-9 | The `no_state_available` sentinel produced by task-010's collectors survives task-009's archive rewrite and collate.py's rendering into `closeout-data.json` unchanged | task-009, task-010 | spec:Requirement 9 |
| INV-10 | The new equivalence/round-trip tests (`test_rollback.py`, `test_pipeline_scheduler.py`) prove task-004's and task-011's migrated modules produce identical observable behavior through the same canonical accessor | task-004, task-011 | spec:Requirement 10 |
| INV-Q1 | `.datum/state.json` as a live write-through cache is dropped entirely; only `.datum/runs/<run_id>/state.json` (archival export) and `datum-tui`'s state.db-backed read survive | task-001, task-012 | question:Q1 |
| INV-Q2 | `load_state`/`save_state`/`update_state` are adopted unchanged as the canonical contract; any hardening happens only under a concrete migrated-module test gap, never as a shape/signature redesign | task-001, task-004 | question:Q2 |
| INV-Q3 | Migration lands incrementally, one module per lane, in the fixed order (tested modules first, `pipeline_scheduler.py` last), each independently reviewable and revertible | task-001, task-002, task-011 | question:Q3 |
| INV-Q4 | Only `corpus_sql.py` (SQL-queryable need) and `migrate.py` (one-shot legacy import) are permitted documented exceptions; every other of the 12 modules ends on the canonical accessor with zero exceptions | task-007, task-008 | question:Q4 |
| INV-Q5 | `docs/architecture/state-store.md` records that Q5's answer (a `SCHEMA_VERSION` constant plus a `kv_state` key/owner docstring table) is deliberately NOT implemented by any task in this epic — `state.db`'s schema stays unversioned beyond task-001's own doc, a scope gap explicitly flagged for the epic owner rather than silently dropped | task-001 | question:Q5 |
| INV-Q6 | `docs/architecture/state-store.md` records that Q6's answer (a 5s `busy_timeout` on every connection) is deliberately NOT implemented — `update_state()` retains only its existing `EXCLUSIVE` transaction, per SPEC's Out-of-Scope bar on new locking primitives, a scope gap explicitly flagged rather than silently dropped | task-001 | question:Q6 |
| INV-Q7 | `docs/architecture/state-store.md` records that Q7's answer ("a missing db must raise a named error, never return `{}`") is superseded by SPEC's Failure-Modes contract — `load_state()` continues returning `{}` on a missing/uninitialized `state.db` and must never raise, which every migrated module's empty-state AC (task-002 through task-011) and task-012's AC depend on | task-001, task-002, task-012 | question:Q7 |
