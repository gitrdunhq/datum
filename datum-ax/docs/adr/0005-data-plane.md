# ADR-0005: Data & State Plane (Valkey + libSQL)

## Status

Accepted (design)

## Context

datum keeps state in three places that can silently diverge: `state.db` (SQLite, WAL),
a write-through `state.json`, and an **agent-written** `pipeline-state.json` (written via an LLM
`agent("write this content…")` call with no success acknowledgement). There is no atomic boundary
across them. We need a clean split between volatile loop state and durable records, with a single
authoritative store per tier and **no LLM-mediated writes**.

## Decision

Two stores, each authoritative for its tier:

- **Valkey (hot, `:6379`)** — the LangGraph checkpointer (ADR-0002). Volatile DAG state for the rapid
  3-attempt loop; resume / time-travel / HITL. RAM-resident; persistence optional.
- **libSQL / sqld (durable)** — the run ledger + telemetry + **per-attempt token accounting**
  (ADR-0009, ADR-0013). Standard `.db` format. **Per-run DB isolation** via *file-copy / SQLite
  Backup API* (a logical snapshot — not magic copy-on-write): copy before an ephemeral test, delete
  after. Embedded libSQL suffices for single-dev; run `sqld` as a server only when multiple hosts
  need shared access.

State writes are performed by orchestrator Python with one transaction boundary per write — **never**
by a model.

## Consequences

- Eliminates datum's tri-source drift; there is exactly one source of truth per tier.
- Per-run DB branching gives test isolation without a heavyweight DB; documented as logical-copy so
  no one relies on unverified CoW semantics (RESEARCH-NOTES).
- Choice mirrors datum's existing SQLite/DuckDB footprint, so the durable side is familiar.
- The "eliminate Postgres to avoid MVCC write amplification" framing from the blueprint is dropped as
  over-justification; the real rationale is volatile-RAM-state + simple-file-DB fit.
- Valkey is treated as **ephemeral**: losing it loses in-flight loop state but not the durable ledger;
  recovery is re-run from the last libSQL-recorded checkpoint reference.
</content>
