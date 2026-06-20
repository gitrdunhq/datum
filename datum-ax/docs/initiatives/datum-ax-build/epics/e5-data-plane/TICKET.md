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

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
