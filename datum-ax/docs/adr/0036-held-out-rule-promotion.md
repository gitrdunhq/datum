# ADR-0036: Held-Out Promotion Gate for Learned Rules

## Status

Accepted (design). Not built. **Refines ADR-0020** (the compound-engineering loop) and depends on a
real **multi-run ledger** (ADR-0013/0031) — the "richer lesson derivation from a real multi-run
ledger" already flagged as pending in ADR-0020. Prior art: **Arbor** (RUC-NLPIR) — *"the single most
important guardrail against self-deception is the split between the signal executors optimize and the
signal that decides what's kept"* (iterate on a dev signal; merge only on a margin-gated held-out
metric).

## Context

The compound loop (ADR-0020) harvests a `Lesson` from a run's ledger trace, turns it into a
`RuleRegistryEntry` (`schemas/rules.py`), and — for the safe tiers — **auto-binds** it
(`core/compound/{harvest,closeout}.py`, `RuleBinder.add_rule`). The decision to keep a rule is made
from the **same run that produced it**: the lane went green / the pattern matched *in its origin run*.
`record_fire`/`prune_unfired` add only a **usage** signal (did the rule fire later?) — not a **value**
signal (did firing actually *help*?). A rule can fire and still be useless, or worse, overfit the
quirk of the run that birthed it and degrade unrelated runs. That is exactly the self-deception Arbor
guards against, and datum-ax currently has no guard for it.

## Decision

**Two-signal promotion: the signal a rule is optimized on is not the signal that keeps it.**

- A freshly harvested rule enters **probation** (`PROPOSE_AND_GATE`) regardless of tier — it is lifted
  as steering / proposed, but not yet a permanent `AUTO_BIND` guardrail.
- A probationary rule is **promoted** to a kept rule only on **held-out evidence**: runs it was *not*
  harvested from. Promotion requires a **deterministic value margin** computed from the ledger —
  e.g. for matching `scope_tags`, the rule's presence **lowers REPEATED_FAILURE / EEDOM_REJECT
  incidence across ≥N independent runs and never raises gate rejects**. The value signal is pure
  ledger arithmetic (verdict/attempt rates) — **zero-LLM**, reproducible.
- **Demotion / revert** if a promoted rule's held-out value later regresses past the margin. Revert is
  permanent-until-new-evidence (no silent re-bind — Monotonicity, ADR-0020).
- This governs **which learned rules bind**, not gate verdicts. eedom and the discipline gates
  (ADR-0006/0010) are untouched and remain hard-deterministic / zero-LLM.

The origin-run "it fired / it went green" remains the **optimize** signal that *generates* candidates;
the cross-run held-out margin is the **keep** signal that *promotes* them. Keeping these distinct is
the whole point.

## Consequences

- Learned rules earn their keep on evidence **independent of their origin** — structural protection
  against overfitting the harvest, the gap ADR-0020 left open.
- Hard dependency on a **cross-run ledger** (G6/G8): promotion can't be evaluated within a single run.
  Until that exists, harvested rules simply stay in probation (safe default — they steer, they don't
  silently entrench).
- `RuleRegistryEntry` gains probation state + held-out-evidence references (origin run vs corroborating
  runs) + the promotion margin; `RuleBinder`/registry gain a promote/demote transition driven by the
  ledger rather than by `add_rule` at CLOSEOUT.
- Property-test targets: **Non-repudiation** (a promoted rule traces to ≥1 held-out improvement),
  **Monotonicity** (a reverted/demoted rule never silently re-binds), **Determinism** (promotion is a
  pure function of the ledger — same ledger ⇒ same promotions).
- Cost stays aligned with tokenomics (ADR-0009): probationary rules that never prove value are pruned,
  so the active rule set tracks demonstrated value, not harvest volume.
