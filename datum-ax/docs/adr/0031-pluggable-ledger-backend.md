# ADR-0031: Pluggable Ledger Backend (local SQLite → centralized DB)

## Status

Accepted (built — port + factory + local SQLite adapter; centralized adapter is the documented seam)

## Context

The MVP run ledger (ADR-0005/0013) is local SQLite — perfect for a single developer. But if datum-ax
grows to **multiple users / shared runs**, the ledger needs to move to a **centralized database**
(Postgres, or hosted libSQL/Turso) without rewriting the pipeline. We don't want a DB choice baked
into `core`.

## Decision

Put the ledger behind a **port** and select the backend in the composition root (dependency
inversion, ADR-0026).

- **`contracts.ledger.RunLedger`** — the port (`record_node` / `get_trace` / `totals` /
  `tokens_spent`). `core` and `presentation` depend on this Protocol, never a concrete backend.
- **`LibSQLLedger`** — the local SQLite adapter (default; `:memory:` or file).
- **`build_ledger(url)`** (composition root) — selects the backend by **URL scheme**:
  - `:memory:`, a path, or `sqlite:///path` → `LibSQLLedger` (default; `DATUM_LEDGER_URL` env honored).
  - `postgresql://`, `libsql://`, `turso://`, … → **raises a clear seam error** until that adapter
    exists.
- A **centralized backend is added as another `RunLedger` adapter** (e.g. `PostgresLedger`) and
  dispatched in `build_ledger` — **zero changes in `core`**. Dialect differences (SERIAL vs
  AUTOINCREMENT, `now()` vs `datetime('now')`) live inside each adapter.

## Consequences

- Scaling to a shared/centralized DB is a **config change** (`DATUM_LEDGER_URL`) plus one adapter —
  not a refactor.
- A **single conformance test** (`test_ledger_port.py`) runs over every `RunLedger` factory, so a new
  backend must satisfy the same metering/run-scoping contract (substitutability / Liskov).
- Remote schemes fail **loudly** (not silently downgrading to SQLite) until wired — no accidental
  "where did my multi-user data go?".
- Property targets: Substitutability (every adapter passes the same contract), Isolation (run-scoping
  holds per backend), Non-repudiation/Determinism (metering faithful per backend).
- Follow-up: implement the first centralized adapter (`PostgresLedger`) + an optional `postgres` extra
  when multi-user lands; consider the same port shape for the Valkey checkpointer.
</content>
