# ADR-0009: Tokenomics — Right Model for the Right Work

## Status

Accepted (design)

## Context

The core efficiency principle: **token-mining, not token-maxing.** Tokens (and latency, and memory)
are spent only where they buy correctness. Much of a coding pipeline is *not* a reasoning problem —
platform routing, gate decisions, lint parsing — and should cost zero tokens. Where a model is
needed, the smallest sufficient one should run.

## Decision

A **deterministic router** selects the model tier per unit of work:

| Work | Path | Token cost |
|------|------|-----------|
| Platform triage, DAG ordering validation | pure Python | **0** |
| eedom review decision | eedom (deterministic) | **0** |
| Lint/test result parsing | pure Python | **0** |
| Cheap classification | `TRIAGE` role (small) | low |
| Planning + code generation | `EXECUTOR` role (MoE) | medium |
| Failure reasoning / error reformatting | `ADVERSARIAL` role (reasoning) | as needed |

Rules:
- **Default to the cheapest viable tier.** Escalate up only on the escalation-ladder signals (low
  confidence / repeated failure / timeout) borrowed from datum — never by default.
- **Meter every call.** Per-attempt token spend (prompt + completion, by role) is recorded in the
  libSQL ledger (ADR-0013) so routing thresholds are tuned with evidence, not vibes.
- **Hard ceiling.** A global per-run token budget (ADR-0013) aborts or suspends a runaway run.

## Consequences

- The zero-token deterministic paths are a feature, not an afterthought — they are why the design is
  cheap to run.
- Routing is itself deterministic (no "use a model to pick a model"), keeping the decision auditable.
- Prompt-prefix caching (ADR-0003/0004) compounds the savings: the cheapest token is the one oMLX
  doesn't re-prefill.
- The metering schema must be defined early (ADR-0013) or the routing can't be tuned.
- Escalation must be bounded by the loop cap (ADR-0007) so it can't ladder forever.
</content>
