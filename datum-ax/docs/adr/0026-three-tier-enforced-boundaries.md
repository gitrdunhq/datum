# ADR-0026: Three-Tier Architecture with Enforced Boundaries

## Status

Accepted (design + enforced in code from E1)

## Context

Architecture discipline is non-negotiable here: **three tiers always, hard boundaries, a typed
contract at every handoff.** eedom already follows this (`cli → core → data`, imports flow downward
only). datum-ax adopts the same shape and makes the boundary **mechanically enforced**, not a
convention people remember.

## Decision

Three tiers plus a shared contract/boundary layer, with **dependency inversion** so the core never
depends on concrete I/O:

| Layer | Package | Responsibility | May import |
|-------|---------|----------------|------------|
| Presentation | `datum_ax.presentation` | entry points: CLI, agent, skills, composition root | core, data, contracts, schemas |
| Core | `datum_ax.core` | orchestration logic: graph, planner, loop, gates, routing | **contracts, schemas only** |
| Data | `datum_ax.data` | persistence + external: Valkey, libSQL, oMLX, ExecutionHost, Serena/eedom/GitHub | **contracts, schemas only** |
| Boundary | `datum_ax.contracts` | Protocols at every handoff (ports) | schemas, `_base` |
| Boundary | `datum_ax.schemas` | shared domain value objects | `_base` |

**Hard rules:**
- **Imports flow downward only.** `core` **never** imports `data` or `presentation`; `data` never
  imports `core` or `presentation`; nothing imports `presentation`.
- **Dependency inversion at the core↔data seam.** `core` depends on `contracts` (Protocols); `data`
  *implements* them; `presentation` (the composition root) constructs concrete `data` adapters and
  injects them into `core`. The core is testable with fakes, swappable by config (oMLX, hosts, stores).
- **A typed contract at every handoff.** Every cross-layer value is a strict, immutable, closed
  Pydantic model (`Contract` base: `strict=True, frozen=True, extra="forbid"`) or a `runtime_checkable`
  Protocol. No dicts, no stringly-typed payloads crossing a boundary.

**Enforcement:** `tests/test_architecture.py` parses the import graph (AST) and **fails the build on
any upward or skip-tier import.** The boundary is a test, not a docstring.

## Consequences

- The core is pure logic: no oMLX/Valkey/container/GitHub import can leak into it — provable, not
  trusted.
- Swapping a data adapter (oMLX → another runtime; Docker host → Tart) touches only `data` +
  composition root; `core` is untouched.
- E1 builds the boundary first (contracts + schemas) — correct under contract-first ordering; the
  empty `core`/`data`/`presentation` packages exist from day one with the rule enforced.
- Every model being strict/frozen/closed makes tampering and shape drift impossible at runtime.
- Property-test targets: Integrity (no boundary accepts an unknown/mistyped field), Isolation (tiers
  never reach across except via contracts), Determinism (contracts round-trip losslessly).
