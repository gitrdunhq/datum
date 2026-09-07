# Unify `.datum/state.json` readers/writers behind one db-backed accessor

## Summary

`datum/state.py` maintains `.datum/state.db` (sqlite) as its store of record but also write-through mirrors every write to `.datum/state.json` from two separate call sites (`save_state()`, `update_state()`). At least 7 other modules implement their own independent `STATE_FILE`/`load_state()`/`save_state()` against `.datum/state.json` directly, bypassing `state.db` entirely, and 5 more modules read `.datum/state.json` via a bare `Path(...)` with no shared accessor at all. This epic designates `datum/state.py`'s db-backed accessor as canonical, migrates all confirmed independent implementations onto it, and documents the fate of `.datum/state.json` so `state.db` and `state.json` can no longer silently diverge.

## Context

`datum/state.py` (`load_state()` lines 274-286, `save_state()` lines 289-303, `update_state()` lines 415-450) is the only implementation backed by `.datum/state.db` (sqlite `kv_state` table, key `"current"`). `save_state()` and `update_state()` each independently write-through the same dict to `.datum/state.json` after committing to the db — two divergent write sites for the same file, per the TICKET's own claim, confirmed in scan.

Codebase scan confirms 7 (not 8 — see Requirement 8 below) independent JSON-only implementations that must migrate: `datum/spec_drift_detector.py` (lines 22, 30, 37), `datum/pr_comment_monitor.py` (lines 34, 38, 42 — has existing test coverage at `tests/test_pr_comment_monitor.py`), `datum/status_render.py` (lines 14, 29, read-only), `datum/rollback.py` (line 17 `STATE_FILE`, line 166-167 inline write, no wrapper functions, no test file), `datum/no_diff_guard.py` (lines 43, 48, inline `Path(".datum/state.json")`, no module-level constant), `datum/pipeline_scheduler.py` (line 27, read-only, pipeline-critical per TICKET), and `datum/path_utils.py` (`state_file()` lines 30-31, `STATE_FILE` via `__getattr__` lines 40-41, `load_state()` lines 60-67 — scan found zero callers anywhere in the repo, i.e. dead code).

`datum/migrate.py` (lines 19, 49, 55) is also an independent JSON-only implementation, but its entire purpose is schema migration of `.datum/state.json` itself — it cannot be treated as a mechanical swap onto `load_state()`/`save_state()` without first deciding whether `state.json` continues to exist as a migratable artifact (see Requirement 1).

Of the 5 bare-`Path` readers the TICKET names, scan confirms 3 real hits — `datum/report_bug.py` (line 109, read-only, best-effort, exceptions swallowed), `datum/archive.py` (line 76, read-only fallback for `run_id` derivation), `datum/memory/corpus_sql.py` (lines 431-434 read `state.json` into a DuckDB view, lines 454-466 separately `ATTACH` `state.db` read-only) — and 2 stale claims: `datum/gate.py` has no `state.json`/`state.db` reference on this branch, and `datum/gc.py` only holds `"state.json"`/`"state.db"` as string literals in a `_PROTECTED_NAMES` frozenset (lines 113-116), never reading file contents. Scan additionally surfaced an undisclosed 9th ad-hoc reader, `datum-tui/data.py:18`, whose module docstring states it intentionally avoids importing the `datum` package.

Legitimate, out-of-scope archival exports already exist and are structurally different from the live cache: `rollback.py` and `archive.py` write point-in-time snapshots to `.datum/runs/<run_id>/state.json`, matching the TICKET's explicit carve-out.

## Requirements

1. **Canonical accessor.** `datum/state.py`'s `load_state()`, `save_state()`, and `update_state()` are the one canonical accessor for live `.datum/state` reads/writes for all in-process Python modules.
   - AC: `datum/state.py` exports `load_state`, `save_state`, `update_state` with unchanged signatures after this epic (no breaking signature change to the 3 canonical functions).
   - AC: `grep -rn "STATE_FILE\s*=" datum/ --include='*.py'` returns zero matches outside `datum/state.py` after migration, except in `datum/rollback.py` and `datum/archive.py` where `STATE_FILE`/equivalent refers only to the archival-export path (`.datum/runs/<run_id>/state.json`), never to a live cache path.
   - AC: `grep -rn "def load_state\|def save_state" datum/ --include='*.py'` returns matches only in `datum/state.py` after migration.

2. **Migrate the 7 confirmed independent implementations.** `spec_drift_detector.py`, `pr_comment_monitor.py`, `status_render.py`, `rollback.py`, `no_diff_guard.py`, `pipeline_scheduler.py`, `path_utils.py` each replace their local `STATE_FILE`/`load_state`/`save_state` definitions with calls into `datum.state.load_state`/`save_state`/`update_state`.
   - AC: each of the 7 modules' source file, after migration, contains zero local re-definitions of `load_state`, `save_state`, or `STATE_FILE` as a JSON-file constant.
   - AC: for the 2 modules with pre-existing test coverage or pipeline-critical status (`pr_comment_monitor.py`, `pipeline_scheduler.py`), the existing test suite (`tests/test_pr_comment_monitor.py` and a new `tests/test_pipeline_scheduler.py`) passes unchanged in behavior (same observable read/write results) before and after migration.
   - AC: `path_utils.py`'s `load_state()`/`state_file()`/`current_run_id()` are either removed (since scan found zero callers) or redirected to `datum.state.load_state`; whichever is chosen, `python -c "import datum.path_utils"` succeeds with no import errors and the module docstring no longer claims to be the sole "SSOT for all path resolution" for state.

3. **`migrate.py` handling.** `datum/migrate.py`'s fate is decided explicitly, not swapped mechanically, because its stated purpose is schema-migrating `.datum/state.json` itself.
   - AC: after Requirement 1's decision on `state.json`'s fate, `migrate.py` either (a) is retargeted to operate on `state.db` schema versions instead of `state.json`, or (b) continues operating on `state.json` solely as a one-shot legacy-import path with its own test coverage, or (c) is deleted if no longer reachable — one of these three outcomes is implemented and stated in a code comment at the top of `migrate.py`.

4. **Migrate the confirmed bare-`Path` readers.** `report_bug.py`, `archive.py`, `corpus_sql.py` replace their direct `Path(".datum/state.json")` reads with `datum.state.load_state()` (or, for `corpus_sql.py`, an explicitly-documented SQL-queryable exception per Requirement 5).
   - AC: `report_bug.py` and `archive.py` contain zero occurrences of the literal string `.datum/state.json` after migration.
   - AC: `report_bug.py`'s existing try/except-wrapped best-effort read behavior (silently continue on missing/corrupt state) is preserved: a test that deletes `.datum/state.db` and confirms `report_bug.py`'s enrichment step does not raise.

5. **`corpus_sql.py` exception, documented.** `datum/memory/corpus_sql.py`'s dual-path direct SQL access (`ATTACH .datum/state.db` read-only, plus a raw-file DuckDB view over `state.json`) is retained as an intentional, documented exception to Requirement 1, on the same basis as the `rollback.py`/`archive.py` archival carve-out — it needs a queryable interface, not a Python dict.
   - AC: `datum/memory/corpus_sql.py` contains a code comment directly above both direct-access blocks explaining why they bypass `load_state()`/`save_state()`.
   - AC: if `state.json` is dropped per Requirement 1, `corpus_sql.py`'s `state.json`-backed view is removed or repointed to read from `state.db` only; a test confirms `corpus_sql.py`'s analytics queries still return the same shape of result (same column names) when `state.json` does not exist on disk.

6. **`gate.py` and `gc.py` claims corrected, no migration performed.** Since scan found no live `state.json`/`state.db` read in either file, no accessor migration is made to `gate.py` or `gc.py` under this epic.
   - AC: `gate.py` and `gc.py` are unmodified by this epic's changes (`git diff` against pre-epic HEAD shows no hunks touching these 2 files for state-accessor reasons).
   - AC: `gc.py`'s `_PROTECTED_NAMES` frozenset (lines 113-116) is updated to match whatever files exist post-Requirement-1 decision (e.g. drop `"state.json"` from the set if the file is dropped entirely; keep it if kept as an export).

7. **`datum-tui/data.py` exception, documented.** The 9th ad-hoc reader discovered in scan, `datum-tui/data.py:18`, is explicitly excluded from migration because its docstring states an intentional dependency-avoidance design (it must not import the `datum` package).
   - AC: `datum-tui/data.py` retains its own `load_state()` implementation, with a comment referencing this epic and stating the reason it is exempt.

8. **`state.json` fate decision, documented.** The fate of `.datum/state.json` as a live cache (not the archival snapshot use in `runs/<run_id>/state.json`, which is unaffected) is decided and recorded in a markdown doc.
   - AC: a decision doc (e.g. `docs/architecture/state-store.md` or a section in this SPEC's companion ADR) states one of: (a) `state.json` live cache is dropped entirely — `save_state()`/`update_state()` no longer write it, or (b) `state.json` live cache is kept, with `save_state()`/`update_state()` continuing to write it as before.
   - AC: whichever is chosen, `tests/test_state_db.py` (or a new test) asserts the chosen behavior: if dropped, a test confirms `save_state()` no longer creates/updates `.datum/state.json`; if kept, a test confirms it still does.

9. **FU-4 closeout collectors revisited.** After Requirement 1-8 land, `collect_tasks.py` and `collect_token_metrics.py` (the closeout collectors that motivated this epic) are updated so "no telemetry available" produces an explicit signal distinguishable from "zero work happened."
   - AC: when `load_state()` returns `{}` (no state ever written), `collect_tasks.py` writes a `closeout-raw/tasks.json` containing an explicit `{"status": "no_state_available"}` (or equivalent named sentinel) rather than exiting with `sys.exit(1)` before writing anything.
   - AC: `collate.py`'s rendered `closeout-data.json` shows a non-null, non-zero sentinel value for `tasks` in this case, verified by a test that runs the collector against an empty/missing state and asserts the sentinel value is present in the collated output.

10. **Real test coverage for pipeline-critical modules.** Per TICKET's explicit callout, `gate.py`... (n/a, no migration per Requirement 6) and `pipeline_scheduler.py` — plus `rollback.py`, which scan found has zero existing test coverage despite performing a direct, non-wrapped state write — get new or updated test coverage before/after migration.
   - AC: `tests/test_pipeline_scheduler.py` exists and asserts `pipeline_scheduler.load_state()`-dependent behavior (e.g. scheduling decision) is unchanged when reading via the canonical accessor vs. the pre-migration JSON-only path, using equivalent fixture data.
   - AC: `tests/test_rollback.py` exists and asserts a rollback operation that reads and writes state via the canonical accessor round-trips the same dict shape as the pre-migration inline `STATE_FILE.write_text(json.dumps(...))` did.

## Failure Modes

| Failure | Handling |
|---|---|
| A migrated module cannot cleanly adopt `load_state()`/`save_state()` (e.g. `corpus_sql.py` needs SQL-queryable access, `migrate.py` needs a different function shape) | Documented, explicit exception per Requirement 5/3 — not silently left on the old path with no comment |
| `state.db` missing or zero-byte at read time | `load_state()` already handles this (returns `{}` on `OperationalError`, per scan) — migrated callers must treat `{}` as "no state," not raise |
| `state.json` still referenced by an un-migrated external consumer (e.g. `datum-tui`) after this epic if `state.json` is dropped | Requirement 7 documents `datum-tui/data.py` as an explicit exception; if Requirement 8 drops `state.json` entirely, `datum-tui`'s `load_state()` degrades to reading a nonexistent file — must be verified to fail gracefully (empty dict / documented error), not crash the TUI |
| Two callers race to `update_state()` concurrently (e.g. two pipeline stages writing state at once) | `update_state()`'s existing sqlite `EXCLUSIVE` transaction (scan-confirmed, state.py ~415-450) is retained as-is; no new locking is introduced by this epic since scan found no evidence multi-process concurrent writers exist beyond what `EXCLUSIVE` already serializes |
| `collect_tasks.py`/`collect_token_metrics.py` misinterpret post-migration `{}` state as "collector never ran" (the original FU-4 bug) | Requirement 9's explicit sentinel closes this gap |
| Migrating `path_utils.py` breaks an undiscovered caller not found by scan | Requirement 2's AC requires `import datum.path_utils` to succeed with no errors; a repo-wide `grep` for `path_utils.load_state\|path_utils.state_file\|path_utils.current_run_id` is re-run immediately before deleting those functions, not only during initial scan |

## Non-Functional Requirements

| Requirement | Target |
|---|---|
| No new production callers introduced to the canonical accessor beyond the 7+3 migrated modules and the 2 documented exceptions | `grep -rn "STATE_FILE\s*=\|Path(\".datum/state.json\")\|def load_state\|def save_state" datum/ --include='*.py'` after migration matches only `datum/state.py`, `datum/rollback.py` (archival path), `datum/archive.py` (archival path), `datum/memory/corpus_sql.py` (documented exception), `datum-tui/data.py` (documented exception) |
| Migration does not regress existing test suite | `pytest` (per `.datum/config.json` `test_command`) exit code 0 across the full suite after each module's migration commit |
| `update_state()` read-modify-write stays inside a single sqlite transaction per call | unchanged from pre-epic behavior — no new multi-statement non-transactional writes introduced |
| Migrated modules' write latency to state | no regression beyond current `save_state()`/`update_state()` baseline — sqlite write + optional json write-through (if kept) is not replaced with anything slower, e.g. no added network calls |

## Out of Scope

- Re-architecting how the TS Workflow pipeline (`skills/src/datum-tdd-act*.ts`) tracks lane execution, or whether lane telemetry should ever flow into `state.db`.
- Touching `.datum/pipeline-state.json` (a separate, already branch-scoped, already-correct file managed by `reset_stale_pipeline_state()` in `datum/pipeline_state.py`) — unrelated to this epic.
- Migrating or altering the archival snapshot writers in `rollback.py`/`archive.py`/closeout collectors that write to `.datum/runs/<run_id>/state.json` — these are a legitimate, separate point-in-time export pattern, not the live cache this epic targets.
- Migrating `datum/gate.py` or `datum/gc.py` onto the canonical accessor — scan found neither currently reads `state.json`/`state.db` contents (see Requirement 6).
- Redesigning `datum/state.py`'s canonical function signatures or storage schema (SQLite table shape, key naming) — this epic adopts them as-is per the Assumption Audit below.
- Adding new locking/transaction primitives beyond `update_state()`'s existing `EXCLUSIVE` sqlite transaction — no evidence found in scan of a concurrency gap this epic must close.

## Open Questions

### Q1 [Architecture] What is the decision criterion for `.datum/state.json`'s fate — drop entirely, keep as archival-only, or keep as a live write-through cache?
The TICKET names two options (drop entirely vs. keep as one-shot archival export) but gives no principle for choosing. Requirement 8 and Requirement 3 (`migrate.py`'s fate) both depend on this decision landing first.

### Q2 [Architecture] Should `load_state()`/`save_state()`/`update_state()` be redesigned as part of this work, or adopted unchanged as the canonical accessor?
Scan found these 3 functions have zero production callers today (only tests and a docstring-check template import them), which is unusual for code being designated "canonical" for 12+ consumers. Confirming they're fit-for-purpose as-is, versus needing a richer contract (e.g. typed return, schema validation) before 12 modules build on them, changes the shape of every migration task in Requirement 2.

### Q3 [Scope] Should the migration be an atomic flag-day cutover across all 12 modules, or incremental module-by-module, and if incremental, what order?
Affects whether Requirement 2's 7 modules and Requirement 4's 3 modules can each ship as independent, separately-reviewable and separately-revertible changes, or must land together.

### Q4 [Behavior] If a module cannot cleanly migrate (e.g. `corpus_sql.py`'s SQL-queryable need, `migrate.py`'s schema-migration purpose), is a documented fallback to direct reads an acceptable permanent outcome, or must every one of the 12 modules end on the canonical accessor with zero exceptions?
Requirement 5 and Requirement 3 currently model `corpus_sql.py` and `migrate.py` as permitted, documented exceptions rather than forced migrations; this needs confirmation before being treated as the final design rather than a scoping shortcut.

### Q5 [NFR] Should `state.db`'s schema (the `kv_state` table shape, key naming convention) be versioned and documented before this consolidation proceeds, to prevent the same silent-divergence failure recurring at the schema level?
No architectural principle was given in the TICKET; scan did not find existing schema documentation for `state.db`.

### Q6 [NFR] Does the canonical accessor need new locking/transaction semantics beyond `update_state()`'s existing sqlite `EXCLUSIVE` transaction, given a concurrent-write-race-sweep audit exists in this same session?
A peer audit agent (`concurrent-write-race-sweep`) is active in this session specifically looking for concurrent-write races; if it finds a gap that touches `state.db`, Requirement 8's NFR table and the "no new locking" scope exclusion both need to be revisited before this epic's design is finalized.

### Q7 [Behavior] What test evidence is required to certify "backwards compatible" across the 12+ migrated modules — per-module unit tests only, or a cross-module integration/contract test?
No integration test spanning all 12 target modules exists today. Requirement 10 currently proposes per-module unit tests (`test_pipeline_scheduler.py`, `test_rollback.py`) as sufficient; confirming whether that bar is enough, or whether a single end-to-end "write via canonical accessor, read via every migrated module" test is also required, changes the size of this epic's test-writing scope.

## Assumption Audit

| # | Assumption | Justification | Status | Resolves |
|---|---|---|---|---|
| 1 | `datum/state.py`'s db-backed `load_state()`/`save_state()`/`update_state()` are suitable as the canonical accessor without redesign | Scan confirms these are the only db-backed implementation and match the shape the other modules already loosely mirror (module constant + load/save function pair) | guess | Q2 |
| 2 | The 7 independent implementations + 5 bare-Path readers can be cleanly refactored onto the canonical accessor without major logic changes | Scan's own "patterns" note states migration is "largely swap-the-import, not a new design" for the pattern-matching modules; 2 exceptions (`corpus_sql.py`, `migrate.py`) already carved out in Requirements 3 and 5 | guess | Q4 |
| 3 | No circular dependencies between these 12 modules that would block piecemeal (module-by-module) migration | Not verified by scan — scan reported callers_count for each module but did not run an import-cycle check between the 12 target modules and `datum/state.py` | guess | Q3 |
| 4 | JSON/DB divergence is the root problem, not a symptom of unclear state semantics needing deeper redesign | TICKET frames the ask this way and scan found no evidence of semantic mismatch (all 7 independent implementations store the same flat dict shape) | decided | n/a |
| 5 | `gate.py` does not need migration in this epic | Scan found zero `state.json`/`state.db` references in `gate.py` on the current branch via both git grep and literal-string tokensave search | confirmed | n/a |
| 6 | `gc.py` does not need a load/save accessor migration, only a protected-names update | Scan found `gc.py` only holds `"state.json"`/`"state.db"` as string literals in `_PROTECTED_NAMES`, never parses file contents | confirmed | n/a |
| 7 | `datum-tui/data.py` should remain an intentional exception rather than be forced onto the shared accessor | Module docstring explicitly states it avoids importing the `datum` package by design | decided | n/a |
| 8 | `update_state()`'s existing `EXCLUSIVE` sqlite transaction is sufficient concurrency handling; no new locking is required | Scan confirmed `update_state()` already wraps its read-modify-write in an `EXCLUSIVE` transaction; no evidence in scan of a multi-process concurrent-write scenario beyond what SQLite's isolation already serializes | guess | Q6 |
| 9 | "Backwards compatible" for the 12+ migrated modules means: same observable read/write results (dict shape, values) as before migration, verified by each module's existing or new test suite | No end-to-end integration test spanning all 12 modules exists today per scan; verification approach is per-module unit tests, not a single cross-module contract test | guess | Q7 |

## Classification Metadata

```yaml
estimated_files: 16
estimated_loc: 650
clusters_touched:
  - datum-state-accessor
  - datum-pipeline-modules
  - datum-memory-corpus
  - datum-closeout-collectors
  - datum-tui
new_public_api: false
dependency_additions: []
```
