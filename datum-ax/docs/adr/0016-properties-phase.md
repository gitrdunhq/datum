# ADR-0016: PROPERTIES Phase — Invariants in the DPS-12 Taxonomy

## Status

Accepted (design)

## Context

datum has a `PROPERTIES` phase (2.5) that derives an invariant set from SPEC + TASKS, categorized and
task-traceable. The first datum-ax pass dropped it. Separately, **eedom** already defines a formal
property taxonomy (DPS-12: 14 domains × 4 formal types — SAFETY / LIVENESS / INVARIANT / PERFORMANCE).
These are the same idea; unifying them gives datum-ax a shared invariant vocabulary across generation
and review.

## Decision

Add **PROPERTIES** as a Phase-A step (after PLAN, before ACT). It derives a property set in which
each property carries:

- a **named domain** + **formal type** (SAFETY / LIVENESS / INVARIANT / PERFORMANCE), reusing eedom's
  DPS-12 taxonomy verbatim;
- a **traceability link** to the lane(s)/task(s) that must satisfy it;
- the **evidence shape** that would prove or refute it (feeds SKEPTIC — ADR-0017).

Properties then drive three downstream consumers:
1. **RED tests** must cover each property mapped to their lane (ADR-0010).
2. **SKEPTIC** adversarially probes the properties after GREEN (ADR-0017).
3. **eedom** property checks apply where a property is a policy/security invariant (ADR-0006).

Derivation is a model step (EXECUTOR, or a cheaper tier for low-complexity epics), but the property
**schema** is deterministic and validated. The phase is **ROUTE-gated** (ADR-0018): `hotfix` and
`spike` skip it.

## Consequences

- One invariant vocabulary spans planning, test-writing, adversarial verification, and deterministic
  review — no translation loss between datum-ax and eedom.
- Produces a traceability matrix (property ↔ lane ↔ test ↔ verdict) recorded in the ledger (ADR-0013).
- Risk: over-generating properties for trivial work; mitigated by ROUTE/COMPLEXITY gating and by
  capping property count per lane.
- Requires the property schema to be defined early (it is a contract REFLECT/SKEPTIC/eedom consume).
