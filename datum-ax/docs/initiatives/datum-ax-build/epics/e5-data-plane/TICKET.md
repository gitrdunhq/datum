# TICKET: E5 — Data plane & observability

## Intent
Provide state that survives and is measurable. Implement the `ValkeyCheckpointer` (for ephemeral LangGraph states), the `LibSQLLedger` (for durable run trace and telemetry), and the `LiveStatus` assembler to provide pipeline visibility.

## Requirements
- `ValkeyCheckpointer`: Stub or light in-memory/valkey adapter to checkpoint run states.
- `LibSQLLedger`: Records each node's execution (tokens, duration, verdicts). Stores run trace.
- `StatusProvider`: Composes the `LiveStatus` object (ADR-0029).

## Acceptance Criteria
- [ ] `ValkeyCheckpointer` can save and retrieve a checkpoint (idempotent replay).
- [ ] `LibSQLLedger` records a node execution and retrieves it.
- [ ] `StatusProvider` returns a valid `LiveStatus` JSON representing the current pipeline snapshot.
- [ ] Tier boundary guard passes (data → contracts).

## Constraints & NFRs
- `data` tier implementation (`src/datum_ax/data/state`).
- Strict Pydantic. SQLite can be in-memory `:memory:` for testing `LibSQLLedger`.

## G6 increment — ledger deepening (gap-ledger G6, ADR-0013)

Climb the `LibSQLLedger` from a single flat `trace` table to the ADR-0013 shape, fully in-process via
stdlib `sqlite3` (libSQL is SQLite-compatible).

- **Requirements:**
  - Per-run scoping: a `run_id` column; records and queries scoped by run.
  - Richer node record: `model_role`, `attempt`, `deterministic` (zero-LLM vs model call), `verdict`,
    `created_at` — alongside existing node/model_id/tokens/duration. Back-compatible `record_node`.
  - **Token metering:** `totals(run_id=None)` → `{nodes, input_tokens, output_tokens, total_tokens}`;
    `tokens_spent(run_id=None)` for the global token-budget backstop.
  - **Durability:** a file-backed ledger persists across reconnect (`close()` provided).
  - **Swappable backend (multi-user readiness, ADR-0031):** a `RunLedger` **port** in `contracts`;
    `LibSQLLedger` is the local SQLite impl; a `build_ledger(url)` factory in the composition root
    selects the backend by URL. A centralized DB (Postgres/Turso) drops in as another `RunLedger`
    adapter — **zero core changes**. Unknown/remote schemes raise a clear "seam" error until wired.

- **PROPERTIES (DPS-12):**
  - **Non-repudiation (INVARIANT):** every recorded node is retrievable — proof of action persists.
  - **Monotonicity (SAFETY):** cumulative `tokens_spent` never decreases as nodes are recorded.
  - **Determinism (INVARIANT):** `totals` equals the exact sum of recorded tokens.
  - **Isolation (SAFETY):** records of one `run_id` never appear in another run's totals/trace.
  - **Availability (LIVENESS):** a file-backed ledger's records survive a reconnect.

- **Acceptance:** new tests cover run-scoping, totals/metering, persistence-across-reconnect, and the
  richer record round-trip; existing `test_ledger` stays green; tier boundary intact.

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
