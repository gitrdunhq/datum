# ADR-0002: LangGraph State Machine & Valkey Checkpointer

## Status

Accepted (design)

## Context

datum's orchestration is a largely linear phase chain with isolated per-phase state spread across
SQLite and several JSON files (see ADR-0008). It has no first-class cyclic retry loop, no
cross-phase context retention, and no checkpoint/resume primitive. We need a state machine that
supports cycles, conditional routing, durable resume, and human-in-the-loop suspension.

## Decision

Use **LangGraph** as the orchestration state machine, structured as **two isolated sub-graphs** to
prevent message-array bloat:

- **Phase A — Triage & Planner sub-graph:** ingest → Serena parse → deterministic triage →
  (optional) DAG planning → yield a static step array.
- **Phase B — Verification sub-graph:** the per-step 3-attempt loop (ADR-0007).

State is a typed schema with reducers; `RemoveMessage` (with the `add_messages` reducer) is the
pruning primitive (ADR-0007). Routing uses `add_conditional_edges`; the retry cap uses a
`retry_count` state field plus `recursion_limit` as a hard backstop.

**Checkpointer = Valkey** via the `langgraph-redis` `RedisSaver` (Valkey is wire-compatible with
Redis; ADR-0005). Checkpoints give resume, time-travel, and human-in-the-loop via
`interrupt()` / `Command(resume=...)`.

## Consequences

- **Load-bearing invariant:** on resume a node **re-executes from its start**. All side effects
  (sandbox apply, git push, DB branch) must be **idempotent or placed after `interrupt()`**. This is
  restated in ADR-0007, ADR-0012, ADR-0014 because it touches each.
- Sub-graph isolation keeps the executor's context array small and cache-stable.
- `langgraph-redis` is a community/partner package — pin a version and read its changelog before
  relying on it (RESEARCH-NOTES).
- Valkey holds **volatile** graph state; durable artifacts live in libSQL (ADR-0005). No state is
  written by an LLM (fixes datum's agent-written `pipeline-state.json`).
- Determinism boundary: graph wiring, routing predicates, and triage are deterministic Python; only
  node *bodies* that call `InferenceClient` are probabilistic.
</content>
