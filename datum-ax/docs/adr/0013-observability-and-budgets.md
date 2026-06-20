# ADR-0013: Observability, Timeouts & Budgets

## Status

Accepted (design). **As-built (logging):** the structured-logging half is implemented — a single
`datum_ax/observability.py` (root tier, importable by every tier) exposes `get_logger(__name__)`
and a one-call `configure_logging(level, json_logs, logfile, console, stream)`. structlog renders
the same event stream as human console lines or one JSON object per line (ADR-0027). Every module
emits structured events (`logger.info("lane_executing", lane_id=...)`); a `test_logging_is_centralized`
guard fails the build if any module touches stdlib `logging` or `getLogger` directly. The ledger
run-trace + budget ceilings remain design-level.

## Context

A multi-node, multi-model, looping pipeline is opaque without a trace, and unbounded without explicit
limits. eedom already sets the precedent for explicit timeouts (scanner=60s, combined=180s, OPA=10s,
pipeline=300s). Tokenomics (ADR-0009) is meaningless without measurement and a hard ceiling.

## Decision

- **Structured logging** with `structlog` (matching datum/eedom). Never `print()`.
- **Per-run trace in the libSQL ledger** (ADR-0005): one record per node execution capturing node
  name, model role + ID, **prompt/completion tokens**, duration, attempt number, host, gate verdicts
  (discipline + eedom), and terminal state. This is the evidence base that tunes routing (ADR-0009).
- **Per-node timeouts** from config: inference, sandbox apply, test/lint run, and the eedom gate
  (informed by eedom's own budgets). A node that times out is a failed attempt, not a hang.
- **Global run budget:** a wall-clock ceiling **and** a cumulative token ceiling. Exceeding either
  aborts or `interrupt()`s the run (ADR-0014). This is the hard backstop behind tokenomics.
- **Context-window budget (distinct from the cumulative token budget — the OOM/throughput driver):**
  the *cumulative* budget caps total spend over a run; the *window* budget caps the **instantaneous
  in-memory context of any single call**. On Apple Silicon + oMLX this is the limit that matters for
  (a) the **~80k-token throughput cliff** and (b) **OOM** (ADR-0003). Enforced as: a per-call window
  **target comfortably inside ~80k** (config, e.g. ≤ ~48–64k — generous when every character is
  curated); **active Dynamic Context Pruning** of stale/oversized tool outputs (ADR-0021) plus **eager
  reclamation** (drop completed-lane contexts, prune failed attempts immediately — ADR-0007); and the
  coupling
  **`max_connections × per-call window ≤ unified-memory budget`** (ADR-0003) so concurrency never
  oversubscribes memory. The ledger records per-call window size so the cliff/OOM margin is visible
  and tunable.
- **Determinism boundary recorded:** each node logs whether it was deterministic (zero-token) or a
  model call, so the zero-LLM share of a run is measurable.

## Consequences

- Every run is reconstructable from the ledger; "why did this cost so much / take so long?" is
  answerable.
- Token accounting is a first-class column, not derived after the fact.
- Budgets make runaway loops impossible to leave running unattended.
- Optional later: emit OpenTelemetry spans / LangSmith traces from the same instrumentation points;
  the ledger schema is the source of truth regardless.
- The metering schema must be stable early; downstream routing tuning depends on it.
