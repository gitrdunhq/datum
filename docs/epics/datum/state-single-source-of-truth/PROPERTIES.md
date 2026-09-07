# PROPERTIES.md — state-single-source-of-truth

Derived from SPEC.md (Requirements 1-10, Failure Modes, NFRs, Assumption Audit) and TASKS.md
(task-001..task-012). Categories per the standard 11; only applicable categories are populated
per requirement, but every category has at least one property overall.

## 1. SAFETY — what must NEVER happen

- PROPERTY(SAFETY-001): No module outside `datum/state.py` defines `def load_state` or `def save_state` after migration (SPEC Req 1 AC2, Req 1 AC3).
- PROPERTY(SAFETY-002): No module outside `datum/state.py`, `datum/rollback.py` (archival path), `datum/archive.py` (archival path), `datum/migrate.py` (documented legacy importer), and `datum/memory/corpus_sql.py` (documented exception) assigns a `STATE_FILE = Path(...)` pointing at a live-cache path (SPEC Req 1 AC2, NFR table).
- PROPERTY(SAFETY-003): `report_bug.py`'s enrichment step never raises when `.datum/state.db` is deleted/absent (SPEC Req 4 AC2/AC3, Failure Modes table).
- PROPERTY(SAFETY-004): `load_state()` never raises on a missing or zero-byte `state.db` — it returns `{}` (SPEC Failure Modes table, Req 1 AC1 unchanged-signature guarantee).
- PROPERTY(SAFETY-005): `datum-tui/data.py` never imports `datum`/`from datum` (SPEC Req 7 AC1; task-008 AC).
- PROPERTY(SAFETY-006): `gate.py` and `gc.py` receive no accessor-migration hunks — `git diff` against pre-epic HEAD shows no state-accessor-motivated changes to either file (SPEC Req 6 AC1).
- PROPERTY(SAFETY-007): `archive.py`'s closeout archive step never reports an `archived_to` path for a snapshot it did not actually write when `load_state()` returns `{}` (task-009 AC4).
- PROPERTY(SAFETY-008): `update_state()`'s read-modify-write never spans more than one sqlite `EXCLUSIVE` transaction call (SPEC NFR table, Out of Scope: no new locking primitives).

## 2. LIVENESS — what must EVENTUALLY happen

- PROPERTY(LIVENESS-001): Every one of the 7 confirmed independent implementations (`spec_drift_detector.py`, `pr_comment_monitor.py`, `status_render.py`, `rollback.py`, `no_diff_guard.py`, `pipeline_scheduler.py`, `path_utils.py`) eventually routes its state read/write through `datum.state` (SPEC Req 2).
- PROPERTY(LIVENESS-002): Every one of the 3 confirmed bare-`Path` readers (`report_bug.py`, `archive.py`, `corpus_sql.py` non-exempt path) eventually reads via `datum.state.load_state()` or its documented SQL exception (SPEC Req 4).
- PROPERTY(LIVENESS-003): A write performed via `datum.state.save_state()`/`update_state()` is eventually observable via `datum.state.load_state()` in the same process (contract test, Q7 answer).
- PROPERTY(LIVENESS-004): `docs/architecture/state-store.md` exists before any migration lane's code changes land (task-001 RED Note: "written first").
- PROPERTY(LIVENESS-005): `collect_tasks.py` and `collect_token_metrics.py` eventually write their raw closeout file (exit 0) even when no state/lane markers exist, instead of exiting before writing (SPEC Req 9 AC1).

## 3. INVARIANT — what must ALWAYS be true

- PROPERTY(INVARIANT-001): `datum/state.py`'s `load_state`, `save_state`, `update_state` signatures are unchanged across the entire epic (SPEC Req 1 AC1, Out of Scope).
- PROPERTY(INVARIANT-002): `.datum/runs/<run_id>/state.json` (the archival export) is always written the same way and is unaffected by the live-cache removal (SPEC Out of Scope, Req 8 AC1).
- PROPERTY(INVARIANT-003): `gc.py`'s `_PROTECTED_NAMES` always contains `config.toml`, `state.db`, `state.db-shm`, `state.db-wal` (SPEC Req 6 AC2; task-012 AC5).
- PROPERTY(INVARIANT-004): After task-012, `save_state()` and `update_state()` never create `.datum/state.json` (SPEC Req 8 AC2; task-012 AC1/AC2).
- PROPERTY(INVARIANT-005): `datum.path_utils.datum_dir`, `skill_root`, `run_dir` remain importable and behaviorally unchanged after `path_utils.py`'s dead-helper removal (SPEC Req 2 AC3; task-006 AC3/AC4).
- PROPERTY(INVARIANT-006): `migrate_state()` and `migrate_wfc_directory()` keep their current signatures and behavior after `migrate.py`'s retargeting (task-007 AC5).

## 4. BOUNDARY — valid input ranges

- PROPERTY(BOUNDARY-001): `load_state()` on a repo with no `.datum/state.db` at all returns `{}`, not an exception, not `None` (SPEC Failure Modes table; task-002 AC5, task-011 AC4).
- PROPERTY(BOUNDARY-002): `load_state()` returning `{}` (no state ever written) is a distinct, testable boundary condition from a populated state dict, and every migrated consumer (status_render, report_bug, archive, no_diff_guard, pipeline_scheduler, collectors) has an explicit behavior defined for it (SPEC Req 9; task-002 AC5, task-003 AC3/AC4, task-011 AC4, task-010 AC1).
- PROPERTY(BOUNDARY-003): A repo with neither a legacy `.datum/state.json` nor a `.wfc/` directory hits `migrate.py`'s "Nothing to do" exit-0 path (task-007 AC3, RED Note).
- PROPERTY(BOUNDARY-004): `datum-tui/data.py`'s `load_state()` returns `{}` for a missing, unreadable, or uninitialised `state.db` (task-008 AC4).

## 5. IDEMPOTENT — what is safe to run twice

- PROPERTY(IDEMPOTENT-001): A second `archive` invocation for the same `run_id` is a no-op that prints `{"ok": true, "skipped": true}` and performs no writes (task-009 AC5, `.archive.done` marker).
- PROPERTY(IDEMPOTENT-002): Running `migrate.py`'s legacy import against a repo already migrated (state.db already populated, no legacy state.json) does not corrupt or duplicate state (SPEC Req 3; task-007 AC4 implies single, idempotent import).
- PROPERTY(IDEMPOTENT-003): Calling `datum.state.load_state()` twice in a row with no intervening write returns the same dict both times (basic accessor idempotence, underpins the contract test in Q7).

## 6. ORDERING — order invariants

- PROPERTY(ORDERING-001): `docs/architecture/state-store.md` (task-001) must exist before any of task-002 through task-012 land, since every later lane's RED note or AC cites it by path (TASKS.md dependency graph: task-001 → all).
- PROPERTY(ORDERING-002): `task-008` (datum-tui repointed to `state.db`) must land before `task-012` (live `state.json` write-through dropped) — the dependency graph and task-012's RED note state this explicitly to avoid a TUI regression.
- PROPERTY(ORDERING-003): `task-009` (closeout archive reads from `load_state()`) must land before `task-012` drops the write-through, or closeout archiving would silently produce empty runs (task-009 RED Note; dependency graph task-009 → task-012).
- PROPERTY(ORDERING-004): `task-003` (archive.py derives run_id via `datum.state.load_state()`) must land before `task-006` deletes `path_utils.current_run_id()` (task-006 RED Note, dependency graph task-003 → task-006).
- PROPERTY(ORDERING-005): `update_state()`'s read, modify, and write steps occur inside one sqlite `EXCLUSIVE` transaction, in that order, with no interleaved external write (SPEC NFR table; task-012 Research Findings pitfall note).

## 7. ISOLATION — what cannot leak between contexts

- PROPERTY(ISOLATION-001): A test repo's `.datum/state.db` fixture (via `DB_FILE` monkeypatch) does not leak into or read from a real ambient `.datum/` directory (task-004 Research Findings pitfall: monkeypatch must be set before any `save_state`/`update_state` call).
- PROPERTY(ISOLATION-002): `spec_drift_detector.py`'s drift flag write does not create `.datum/state.json` as a side channel once migrated (task-005 AC4).
- PROPERTY(ISOLATION-003): `corpus_sql.py`'s analytics queries return the same result-column-name set regardless of whether `.datum/state.json` exists on disk — no leakage of file-presence into query shape (SPEC Req 5 AC2; task-008 AC3).
- PROPERTY(ISOLATION-004): `collect_tasks.py`'s no-state sentinel path does not leak into or overwrite the happy-path (lane markers present) result — the two paths remain mutually exclusive (task-010 AC1/AC2).

## 8. PERFORMANCE — latency/throughput/size bounds

- PROPERTY(PERFORMANCE-001): Migrated modules' write latency to state does not regress beyond the current `save_state()`/`update_state()` baseline — no added network calls, no slower path introduced (SPEC NFR table).
- PROPERTY(PERFORMANCE-002): `update_state()`'s single sqlite `EXCLUSIVE` transaction bound is preserved as the sole concurrency-serialization mechanism; no additional transaction/lock layer is added, per the answered Q6 (5s `busy_timeout` is a connection-level allowance, not a new transaction) — connection setup does not materially add per-call latency.

## 9. SECURITY — access controls

- PROPERTY(SECURITY-001): `datum-tui/data.py` reads `.datum/state.db` read-only via stdlib `sqlite3` — it performs no writes to the canonical store (task-008 AC4, Q1 answer: "reads .datum/state.db read-only").
- PROPERTY(SECURITY-002): `corpus_sql.py`'s `ATTACH ... state.db` remains read-only (`READ_ONLY`) — no write path is opened through the SQL-queryable exception (SPEC Req 5; Research Findings task-008 pattern note).
- PROPERTY(SECURITY-003): `migrate.py` is the only module permitted to read a legacy `.datum/state.json`; no other module regains a live-cache read path once task-012 lands (task-007 AC1, task-012 AC4 grep).

## 10. OBSERVABILITY — what must be logged or measured

- PROPERTY(OBSERVABILITY-001): `collect_tasks.py`'s no-state case is recorded as an explicit `{"status": "no_state_available"}` sentinel in `closeout-raw/tasks.json`, not a silent early exit (SPEC Req 9 AC1; task-010 AC1).
- PROPERTY(OBSERVABILITY-002): `collate.py`'s rendered `closeout-data.json` shows a non-null, non-zero sentinel value for `tasks` in the no-state case (SPEC Req 9 AC2; task-010 AC4).
- PROPERTY(OBSERVABILITY-003): `path_utils.py`'s deletion commit message records the fresh, re-run caller grep result for `path_utils.load_state`/`state_file`/`current_run_id`/`STATE_FILE`, per Failure Modes table's explicit re-verification requirement (task-006 AC1).
- PROPERTY(OBSERVABILITY-004): `spec_drift_detector.py`'s and `pipeline_scheduler.py`'s confirmed-orphan/no-real-caller status is reported in the migrating lane's summary rather than silently fixed or silently ignored (task-005 RED Note, task-011 RED Note).
- PROPERTY(OBSERVABILITY-005): `docs/architecture/state-store.md` names `SCHEMA_VERSION`... — deliberately out of scope per Q5/Q6/Q7's affirmative SPEC positions; the doc records that omission explicitly so it is visible rather than silently missing (task-001 RED Note).

## 11. COMPATIBILITY — existing behavior that must be preserved

- PROPERTY(COMPATIBILITY-001): `tests/test_pr_comment_monitor.py` passes with identical observable behavior before and after `pr_comment_monitor.py`'s migration (SPEC Req 2 AC2; task-005 AC3).
- PROPERTY(COMPATIBILITY-002): `report_bug.py`'s try/except silent-continue behavior around state enrichment is preserved exactly (SPEC Req 4 AC2; task-003 AC2/AC3).
- PROPERTY(COMPATIBILITY-003): `render()`'s output for a given state dict is unchanged by the read-path migration in `status_render.py` (task-002 AC4).
- PROPERTY(COMPATIBILITY-004): `no_diff_guard.py`'s pass/block decision for a given state dict is unchanged by migration (task-004 AC4).
- PROPERTY(COMPATIBILITY-005): `pipeline_scheduler.py`'s dispatch decision for a given lane-plan + state fixture is byte-identical pre- and post-migration (SPEC Req 10 AC1; task-011 AC2).
- PROPERTY(COMPATIBILITY-006): `rollback.py`'s round-tripped state dict shape/keys match what the pre-migration inline `STATE_FILE.write_text(json.dumps(...))` produced (SPEC Req 10 AC2; task-004 AC2).
- PROPERTY(COMPATIBILITY-007): `archive.py`'s "no run_id" JSON error message and its unchanged write of `.datum/runs/<run_id>/state.json` are preserved (task-003 AC4/AC5).
- PROPERTY(COMPATIBILITY-008): The full `pytest` suite (per `.datum/config.json` `test_command`) exits 0 after each module's migration commit (SPEC NFR table).

## Traceability Table

| Property ID | Category | Predicate (short) | Task IDs |
|---|---|---|---|
| SAFETY-001 | Safety | No `load_state`/`save_state` defs outside `state.py` | task-002, task-004, task-005, task-006, task-007, task-011, task-012 |
| SAFETY-002 | Safety | No stray live-cache `STATE_FILE` outside allowed files | task-002, task-004, task-005, task-011, task-012 |
| SAFETY-003 | Safety | `report_bug.py` enrichment never raises on missing db | task-003 |
| SAFETY-004 | Safety | `load_state()` never raises, returns `{}` | task-002, task-003, task-011, task-012 |
| SAFETY-005 | Safety | `datum-tui/data.py` imports no `datum` package | task-008 |
| SAFETY-006 | Safety | `gate.py`/`gc.py` untouched except protected-names line | task-012 |
| SAFETY-007 | Safety | `archive.py` never reports false `archived_to` | task-009 |
| SAFETY-008 | Safety | `update_state()` stays one EXCLUSIVE transaction | task-012 |
| LIVENESS-001 | Liveness | 7 independent implementations migrate | task-002, task-004, task-005, task-006, task-011 |
| LIVENESS-002 | Liveness | 3 bare-Path readers migrate | task-003, task-008 |
| LIVENESS-003 | Liveness | Write via accessor is readable via accessor | task-002, task-003, task-004, task-005, task-007, task-008, task-011, task-012 |
| LIVENESS-004 | Liveness | Decision doc exists before code lanes | task-001 |
| LIVENESS-005 | Liveness | Collectors write raw file instead of early exit | task-010 |
| INVARIANT-001 | Invariant | Canonical accessor signatures unchanged | task-001, task-012 |
| INVARIANT-002 | Invariant | Archival export path/behavior unaffected | task-003, task-004, task-009 |
| INVARIANT-003 | Invariant | `_PROTECTED_NAMES` keeps db-file entries | task-012 |
| INVARIANT-004 | Invariant | `save_state`/`update_state` never create `state.json` | task-012 |
| INVARIANT-005 | Invariant | `path_utils` non-state exports stay intact | task-006 |
| INVARIANT-006 | Invariant | `migrate_state`/`migrate_wfc_directory` signatures unchanged | task-007 |
| BOUNDARY-001 | Boundary | No db → `{}` not exception | task-002, task-011 |
| BOUNDARY-002 | Boundary | `{}` boundary handled by every consumer | task-002, task-003, task-004, task-010, task-011 |
| BOUNDARY-003 | Boundary | Neither state.json nor .wfc/ → "Nothing to do" | task-007 |
| BOUNDARY-004 | Boundary | `datum-tui` load_state `{}` on missing/bad db | task-008 |
| IDEMPOTENT-001 | Idempotent | Repeat archive invocation is a no-op | task-009 |
| IDEMPOTENT-002 | Idempotent | Re-running legacy import doesn't corrupt state | task-007 |
| IDEMPOTENT-003 | Idempotent | Repeat `load_state()` calls agree | task-001, task-012 |
| ORDERING-001 | Ordering | Decision doc precedes all other lanes | task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 |
| ORDERING-002 | Ordering | task-008 precedes task-012 | task-008, task-012 |
| ORDERING-003 | Ordering | task-009 precedes task-012 | task-009, task-012 |
| ORDERING-004 | Ordering | task-003 precedes task-006 | task-003, task-006 |
| ORDERING-005 | Ordering | update_state read-modify-write ordering preserved | task-012 |
| ISOLATION-001 | Isolation | Test fixtures don't leak into ambient `.datum/` | task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 |
| ISOLATION-002 | Isolation | Drift flag write creates no state.json side channel | task-005 |
| ISOLATION-003 | Isolation | corpus_sql column-name shape independent of file presence | task-008 |
| ISOLATION-004 | Isolation | Sentinel path and happy path stay mutually exclusive | task-010 |
| PERFORMANCE-001 | Performance | No write-latency regression | task-002, task-004, task-005, task-011, task-012 |
| PERFORMANCE-002 | Performance | Single transaction/lock layer preserved | task-012 |
| SECURITY-001 | Security | `datum-tui/data.py` read-only access | task-008 |
| SECURITY-002 | Security | `corpus_sql.py` ATTACH stays read-only | task-008 |
| SECURITY-003 | Security | Only `migrate.py` reads legacy state.json | task-007, task-012 |
| OBSERVABILITY-001 | Observability | Explicit no-state sentinel recorded | task-010 |
| OBSERVABILITY-002 | Observability | collate.py surfaces non-null/non-zero sentinel | task-010 |
| OBSERVABILITY-003 | Observability | Fresh caller grep recorded in commit message | task-006 |
| OBSERVABILITY-004 | Observability | Orphan-module status reported, not silently altered | task-005, task-011 |
| OBSERVABILITY-005 | Observability | Q5/Q6/Q7 out-of-scope items recorded explicitly | task-001 |
| COMPATIBILITY-001 | Compatibility | pr_comment_monitor tests pass unchanged | task-005 |
| COMPATIBILITY-002 | Compatibility | report_bug try/except behavior preserved | task-003 |
| COMPATIBILITY-003 | Compatibility | status_render render() output unchanged | task-002 |
| COMPATIBILITY-004 | Compatibility | no_diff_guard decision unchanged | task-004 |
| COMPATIBILITY-005 | Compatibility | pipeline_scheduler dispatch decision unchanged | task-011 |
| COMPATIBILITY-006 | Compatibility | rollback round-trip shape unchanged | task-004 |
| COMPATIBILITY-007 | Compatibility | archive.py error message/write unchanged | task-003 |
| COMPATIBILITY-008 | Compatibility | Full test suite passes after each migration commit | task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 |

## Per-Task Property Assignments

- **task-001** (record-state-store-decision): LIVENESS-004, ORDERING-001, IDEMPOTENT-003, OBSERVABILITY-005, INVARIANT-001
- **task-002** (migrate-status-render-to-canonical-accessor): LIVENESS-001, LIVENESS-003, SAFETY-001, SAFETY-002, SAFETY-004, BOUNDARY-001, BOUNDARY-002, ISOLATION-001, PERFORMANCE-001, COMPATIBILITY-003, COMPATIBILITY-008
- **task-003** (migrate-report-bug-and-archive-readers): LIVENESS-002, LIVENESS-003, SAFETY-003, SAFETY-004, INVARIANT-002, BOUNDARY-002, ORDERING-004, ISOLATION-001, COMPATIBILITY-002, COMPATIBILITY-007, COMPATIBILITY-008
- **task-004** (migrate-rollback-and-no-diff-guard): LIVENESS-001, LIVENESS-003, SAFETY-001, SAFETY-002, INVARIANT-002, BOUNDARY-002, ISOLATION-001, PERFORMANCE-001, COMPATIBILITY-004, COMPATIBILITY-006, COMPATIBILITY-008
- **task-005** (migrate-pr-monitor-and-drift-detector): LIVENESS-001, LIVENESS-003, SAFETY-001, SAFETY-002, ISOLATION-001, ISOLATION-002, PERFORMANCE-001, OBSERVABILITY-004, COMPATIBILITY-001, COMPATIBILITY-008
- **task-006** (retire-path-utils-state-helpers): LIVENESS-001, SAFETY-001, INVARIANT-005, ORDERING-004, ISOLATION-001, OBSERVABILITY-003, COMPATIBILITY-008
- **task-007** (retarget-migrate-as-legacy-importer): LIVENESS-003, SAFETY-001, INVARIANT-006, BOUNDARY-003, IDEMPOTENT-002, ISOLATION-001, SECURITY-003, COMPATIBILITY-008
- **task-008** (document-sql-and-tui-exceptions): LIVENESS-002, LIVENESS-003, SAFETY-005, BOUNDARY-004, ISOLATION-003, SECURITY-001, SECURITY-002, ORDERING-002, ISOLATION-001, COMPATIBILITY-008
- **task-009** (archive-live-state-from-canonical-store): LIVENESS-003, SAFETY-007, INVARIANT-002, IDEMPOTENT-001, ORDERING-003, ISOLATION-001, COMPATIBILITY-008
- **task-010** (closeout-no-state-sentinel): LIVENESS-005, BOUNDARY-002, ISOLATION-004, OBSERVABILITY-001, OBSERVABILITY-002, ISOLATION-001, COMPATIBILITY-008
- **task-011** (migrate-pipeline-scheduler-with-equivalence-test): LIVENESS-001, LIVENESS-003, SAFETY-001, SAFETY-002, SAFETY-004, BOUNDARY-001, BOUNDARY-002, PERFORMANCE-001, OBSERVABILITY-004, ISOLATION-001, COMPATIBILITY-005, COMPATIBILITY-008
- **task-012** (drop-live-state-json-write-through): SAFETY-001, SAFETY-002, SAFETY-004, SAFETY-006, SAFETY-008, INVARIANT-001, INVARIANT-003, INVARIANT-004, ORDERING-002, ORDERING-003, ORDERING-005, PERFORMANCE-002, SECURITY-003, IDEMPOTENT-003, ISOLATION-001, COMPATIBILITY-008

## Integration Invariants

| ID | Invariant | Covers | Source |
|---|---|---|---|
| INT-001 | `docs/architecture/state-store.md`, once written by task-001, is cited by name/path and its decisions honored unmodified by every later migration lane (no lane re-decides state.json's fate) | task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 | spec:8 |
| INT-002 | A dict written once via `datum.state.save_state()`/`update_state()` is readable back with identical values via every migrated module's public read path (status_render, report_bug, archive, rollback, no_diff_guard, pr_comment_monitor, spec_drift_detector, pipeline_scheduler, migrate.py, corpus_sql.py, datum-tui/data.py) | task-002, task-003, task-004, task-005, task-007, task-008, task-011 | spec:10 |
| INT-003 | task-008's repoint of `datum-tui/data.py` onto `state.db` must land before task-012 removes the live `state.json` write-through, so the TUI never reads a file that stops existing | task-008, task-012 | spec:8 |
| INT-004 | task-009's repoint of closeout archive onto `load_state()` must land before task-012 removes the write-through, so closeout archiving never silently produces empty runs | task-009, task-012 | spec:8 |
| INT-005 | task-003's migration of `archive.py` off `path_utils.current_run_id()` must land before task-006 deletes that function, so no lane is left calling a removed symbol | task-003, task-006 | spec:2 |
| INT-006 | The sentinel `{"status": "no_state_available"}` written by `collect_tasks.py`/`collect_token_metrics.py` (task-010) survives unmodified through `collate.py`'s rendering into `closeout-data.json`'s `tasks` field as a non-null, non-zero value | task-010 | spec:9 |
| INT-007 | `.datum/state.json` live write-through cache is dropped; `.datum/runs/<run_id>/state.json` archival export is unaffected; `datum/state.py`'s three functions are the unchanged-signature canonical accessor; `corpus_sql.py` and `datum-tui/data.py` are the only two permanent documented exceptions; `migrate.py` is a one-shot legacy importer — all lanes must build on this single decision | task-001, task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 | question:Q1 |
| INT-008 | All 12 target modules adopt `load_state()`/`save_state()`/`update_state()` unchanged in shape, return type, and error handling; hardening is permitted only when a migrated module's own tests surface a concrete gap, each under its own test | task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-011, task-012 | question:Q2 |
| INT-009 | Migration proceeds incrementally, one module per lane, each independently reviewable and revertible, in the order: tested modules first (pr_comment_monitor, status_render), then spec_drift_detector, rollback, no_diff_guard, path_utils, then bare readers (report_bug, archive, datum-tui/data.py), then pipeline_scheduler last with tests written first; any lane that discovers a circular dependency with `datum/state.py` stops and reports rather than working around it | task-002, task-003, task-004, task-005, task-006, task-007, task-008, task-009, task-010, task-011, task-012 | question:Q3 |
| INT-010 | Documented, permanent exceptions to the canonical accessor are limited to exactly two — `corpus_sql.py` (read-only ATTACH of state.db) and `migrate.py` (one-shot legacy state.json importer); every other module ends on the canonical accessor with no direct `state.json` read/write surviving outside the archive export | task-007, task-008, task-012 | question:Q4 |
| INT-011 | `datum/state.py` carries a `SCHEMA_VERSION` constant, stored in the db, plus a docstring table of `kv_state` keys and their owners; no migration framework is introduced | task-001, task-012 | question:Q5 |
| INT-012 | The existing `update_state()` `EXCLUSIVE` transaction remains the sole concurrency mechanism; every connection additionally sets a 5s `busy_timeout` so a concurrent reader retries on SQLITE_BUSY instead of failing; no file lock or new transaction layer is added | task-012 | question:Q6 |
| INT-013 | Backwards-compatibility certification requires both per-module unit tests for each migrated module and one contract test that writes state once through the canonical accessor and reads it back through every migrated module's public read path; a module silently reading empty/stale state is a hard failure, and a missing db must raise a named error from the accessor, never return `{}`, wherever the accessor's own contract (not `load_state()`, which is fixed at Failure Modes' `{}`) requires it | task-002, task-003, task-004, task-005, task-007, task-008, task-011 | question:Q7 |
