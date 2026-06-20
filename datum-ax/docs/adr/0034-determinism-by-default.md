# ADR-0034: Determinism by Default, Reasoning When Warranted

## Status

Accepted. Refines the determinism stance stated across earlier ADRs (notably 0006/0009/0017/0033)
and CURRENT_STATE — those treated determinism as near-absolute; this scopes it.

## Context

datum-ax is a cognition pipeline. Determinism is hugely valuable — reproducible, auditable,
prompt-cacheable, and **free of tokens** — so it is the right *default*. But making it an absolute
law is wrong: some decisions (which skill fits this ticket, why did this attempt fail, how to
decompose an ambiguous epic) need genuine reasoning that a brittle deterministic heuristic can't
capture. We had been writing "deterministic" as if it were unconditional; that over-constrains the
cognitive parts of the system.

## Decision

**As deterministic as possible — not fully deterministic. Where a decision needs reasoning or
complex judgment, an LLM is an acceptable mechanism for that decision.**

- **Prefer the cheapest correct mechanism**, escalating only on demonstrated need — the tokenomics
  ladder (ADR-0009) applied to *decisions*, not just model size:
  **pure logic → lookup/tags → embeddings (RAG) → LLM reasoning.**
- **The trust/review gate is the one hard-deterministic boundary.** Verdicts from eedom and the
  discipline gates (ADR-0006/0010) must be reproducible and **zero-LLM** — that is the point of a
  gate. A non-deterministic gate is not a gate.
- **Cognition may reason.** Routing, planning/decomposition, skill/role selection, REFLECT/SKEPTIC
  (ADR-0017) — these may use embeddings or an LLM when the deterministic path is brittle. The blast
  radius of a bad *cognitive* choice is a worse prompt, not a corrupted decision; the gate still
  backstops correctness.
- **Embeddings are deterministic-ish, not stochastic.** A pinned model + fixed corpus + fixed
  threshold yields the same result every run — so RAG selection is a *default-grade* mechanism, not
  an exception to be quarantined.

### Worked example — skill selection (ADR-0033)

A **tiered selector** behind the `PersonaRegistry` port:
1. **tags** — structural purpose (planning / troubleshooting), deterministic, zero-token;
2. **RAG** — embedding match for open-ended domain fit (which domain persona), deterministic given a
   pinned model;
3. **LLM** — only when the top candidates are ambiguous / below confidence, spend a small reasoning
   call to choose.

Default to tier 1–2; escalate to tier 3 on need.

## Consequences

- Selection/routing/planning are free to use embeddings or an LLM; gates are not.
- Record per-decision whether it was deterministic or model-made (ADR-0013 determinism-boundary
  logging), so the zero-LLM share of a run stays measurable and tunable — "as deterministic as
  possible" is something we can *observe*, not just assert.
- Earlier "must be deterministic" phrasing for cognition (e.g. ADR-0033 skill selection) is relaxed
  to "deterministic by default, may reason"; the gate ADRs are unchanged.
