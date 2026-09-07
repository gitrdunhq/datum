# State store: `.datum/state.json` fate decision

Epic: `docs/epics/datum/state-single-source-of-truth/SPEC.md` (Requirement 8, Requirement 3), answered in `QUESTIONS.md` Q1. This doc is the decision record every later migration lane in that epic cites — it is written first so no lane re-decides it.

## Decision: option (a) — the live write-through cache is dropped

`.datum/state.json` as a **live write-through cache** is dropped entirely. `datum/state.py`'s `save_state()` and `update_state()` no longer write it. `.datum/state.db` (sqlite, `kv_state` table, key `"current"`) is the sole store of record for live state.

This is option (a) of SPEC Requirement 8: *"`state.json` live cache is dropped entirely — `save_state()`/`update_state()` no longer write it."*

Criterion (per QUESTIONS.md Q1): no consumer needs a live JSON mirror. The one out-of-package reader, `datum-tui/data.py`, reads `.datum/state.db` read-only via the stdlib `sqlite3` module, which preserves its no-`datum`-import property without needing a JSON file.

## Archival snapshots are unaffected

`.datum/runs/<run_id>/state.json` — the point-in-time export written by `rollback.py`, `archive.py`, and the closeout collectors — is a structurally different, out-of-scope artifact from the live cache this decision drops. It remains the supported export format, untouched by this decision.

## Canonical accessor

`datum/state.py`'s `load_state()`, `save_state()`, and `update_state()` are the one canonical accessor for live `.datum/state` reads/writes, with unchanged signatures:

- `load_state() -> dict`
- `save_state(state: dict) -> None`
- `update_state(mutator: callable) -> bool`

`load_state()` returning `{}` means "no state written yet." It must never raise. `{}` is a valid, expected return value on a missing or zero-byte `.datum/state.db` (per the SPEC's Failure Modes table and Requirement 9's AC, and implied by Requirement 1's no-breaking-signature-change AC) — callers must treat it as "no state," not as an error condition.

## Permanent documented exceptions (exactly two)

1. **`datum/memory/corpus_sql.py`** — retains a read-only SQL `ATTACH` of `.datum/state.db`, because it needs SQL-queryable access to state for its analytics views; a Python dict from `load_state()` cannot serve that purpose. Its separate raw-file DuckDB view over `state.json` is removed as part of this decision (the live JSON file it depended on no longer exists).
2. **`datum-tui/data.py`** — retains its own state-reading implementation because its module docstring states an intentional design constraint: it must not import the `datum` package. It reads `.datum/state.db` directly (read-only, stdlib `sqlite3`) rather than calling `datum.state.load_state()`.

No other module may keep a direct `state.json`/`state.db` read or write outside the canonical accessor; every other module in the epic's migration list ends on `datum.state.load_state`/`save_state`/`update_state`.

## `migrate.py`'s fate

`datum/migrate.py` is retargeted as a **one-shot legacy `state.json` importer** — SPEC Requirement 3 option (b). It continues to operate on `state.json`, but solely to import a pre-existing legacy file into `state.db` once; it is not a mechanism for ongoing dual-write or ongoing schema migration of a live `state.json`. This choice, and the reason for it, is recorded in a code comment at the top of `migrate.py` when that module is migrated.

## Recorded omission: QUESTIONS.md answers not decomposed into this epic's tasks

`docs/epics/datum/state-single-source-of-truth/QUESTIONS.md` records answers to Q5, Q6, and Q7 that are **not** implemented by this epic's task list, and conflict with SPEC positions that already shipped as Requirements/Out-of-Scope items:

- **Q5** answer: add a `SCHEMA_VERSION` constant in `state.py`, stored in the db, plus a docstring table of `kv_state` keys and owners. The SPEC's Out of Scope section bars "redesigning `datum/state.py`'s canonical function signatures or storage schema" — no schema-versioning task exists in this epic.
- **Q6** answer: add a 5-second sqlite `busy_timeout` on every connection. The SPEC's Out of Scope section bars "adding new locking/transaction primitives beyond `update_state()`'s existing `EXCLUSIVE` sqlite transaction" — no `busy_timeout` change is made by this epic.
- **Q7** answer: "a missing db must raise a named error, never return `{}`." This directly conflicts with the SPEC's Failure Modes table, Requirement 9's AC (which is built on `load_state()` returning `{}` to signal "no state available"), and Requirement 1's AC against breaking the canonical functions' signatures/contract. `load_state()` continues to return `{}` on a missing or empty store; it does not raise. Making it raise would invalidate the acceptance criterion later migration tasks (including the one implementing Requirement 9) are built on.

This gap is recorded here, deliberately, so it is visible at review rather than discovered as a surprise divergence between `QUESTIONS.md` and the shipped behavior. Any future work that wants to act on the Q5/Q6/Q7 answers must open it as a new, explicitly-scoped change against the current Out-of-Scope and Failure-Modes text, not assume it is already covered by this epic.
