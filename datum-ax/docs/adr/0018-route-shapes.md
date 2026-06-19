# ADR-0018: ROUTE Shapes — Pipeline Composition as a Tokenomics Lever

## Status

Accepted (design)

## Context

datum has a `ROUTE` selector (`feature`, `hotfix`, `spike`, `audit`, `resume`, `refine-only`) that
chooses which phases run. This is one of the strongest tokenomics levers available (ADR-0009): the
cheapest phase is the one you don't run.

## Decision

A **deterministic** router picks the ROUTE at ingest from COMPLEXITY / SCOPE / AMBIGUITY (ADR/glossary
classifications) plus an explicit override. Each ROUTE is a set of enabled phases, implemented as a
LangGraph conditional entry point + phase-enabled flags in graph state:

| ROUTE | Phases | Use |
|-------|--------|-----|
| `feature` | REFINE → PLAN → PROPERTIES → ACT → VALIDATE → REVIEW → CLOSEOUT | full build |
| `hotfix` | ACT → VALIDATE → REVIEW | small, scoped fix |
| `spike` | REFINE → PLAN | explore, no implementation |
| `audit` | PROPERTIES → VALIDATE → REVIEW | assess existing code |
| `resume` | continue from the last checkpoint | recovery (ADR-0014) |
| `refine-only` | REFINE | clarify a ticket |

ROUTE gates the expensive optionals: PROPERTIES (ADR-0016), SKEPTIC depth (ADR-0017), GitNexus impact
analysis (ADR-0019), and model-tier defaults (ADR-0009).

**Routes can escalate.** If a `hotfix` turns out to touch a high-blast-radius symbol (per GitNexus,
ADR-0019), the router upgrades it toward `feature` rather than under-verifying.

## Consequences

- Token/latency spend scales with task shape, deterministically and auditably.
- ROUTE is the single place phase-composition lives, so adding a route is additive, not invasive.
- Risk: a wrong route under-verifies; mitigated by escalation on detected blast radius and by the
  deterministic eedom gate always running before any push.
- Requires the ingest classifiers (COMPLEXITY/SCOPE/AMBIGUITY) to be reliable; they are cheap-model or
  heuristic and themselves ROUTE-independent.
