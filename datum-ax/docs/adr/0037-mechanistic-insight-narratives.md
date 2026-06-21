# ADR-0037: Mechanistic Insight Narratives — LLM "Why" Supplements the Deterministic Lesson

## Status

Accepted (design). Not built. **Extends ADR-0020** (lesson capture) and is **governed by ADR-0034**
(determinism by default, reasoning when warranted). Prior art: **Arbor** (RUC-NLPIR) — after each
experiment an LLM abstracts the causal *why* ("the gain comes from calibration, not the new layer";
"data leakage in fold construction") and propagates it. We adopt the *idea* but subordinate it to the
deterministic record.

## Context

`lessons_from_trace` (ADR-0020) derives lessons deterministically from the ledger — verdict and
attempt counts → statements like *"add a regression test for the failure node X retried on."* This is
robust, reproducible, and gate-relevant, but **shallow**: it records *what* happened, not *why*. A
richer causal explanation would improve human review and the quality of steering text — but generating
it requires an LLM, which must never leak onto the trust path. The governing constraint is the user's
framing: **supplement, not replace** — *"if we have deterministic data we can tell a data story."* The
deterministic data is the story's source; the narrative is the telling.

## Decision

**The deterministic `Lesson`/evidence is authoritative; an optional LLM narrative rides on top as
non-authoritative metadata.**

- Add an **optional** `narrative` field (the "why" / data story) to `Lesson` / `RuleRegistryEntry`,
  explicitly **flagged model-made** (ADR-0013 determinism-boundary logging) and attributed.
- **Hard invariants:**
  1. The narrative **never gates** and **never changes any deterministic decision** — lesson
     derivation, rule tier, promotion (ADR-0036), or binding are computed without it and are
     **invariant to its presence or absence**.
  2. It is generated **only when deterministic data exists** — it *explains* recorded evidence, it
     never *invents* a lesson. No deterministic finding ⇒ no narrative.
  3. It is **cognition-tier** (ADR-0034): off in offline / fully-deterministic mode; the gate stays
     zero-LLM. The pipeline is fully functional with narratives disabled.
- Use sites are **human-facing review UX** (explaining a proposed rule) and optionally **richer
  steering text** for a lifted rule — never the verdict path.

## Consequences

- Better human rationale and steering quality without compromising determinism or auditability — the
  deterministic evidence and the model narrative are stored and labeled **separately**, so a reader can
  always see the zero-LLM basis under the prose.
- A new (optional) LLM call at harvest, on the cognition side of the determinism boundary; metered like
  any other reasoning call (ADR-0009/0013).
- Property-test target: **harvest / promotion / binding outcomes are identical with and without the
  narrative** (the deterministic decision is invariant to narrative presence) — the formal statement of
  "supplement, not replace."
- No change to eedom, the discipline gates, or ADR-0036's deterministic promotion math.
