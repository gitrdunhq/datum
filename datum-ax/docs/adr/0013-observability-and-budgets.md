# ADR-0013: Observability, Timeouts & Budgets

## Status

Accepted (design)

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
- **Global run budget:** a wall-clock ceiling **and** a token ceiling. Exceeding either aborts or
  `interrupt()`s the run (ADR-0014). This is the hard backstop behind tokenomics.
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
</content>
