# TICKET: E1 — Contracts & schemas

<!-- Emulated output of nl-to-ticket (ADR-0024) on epic E1 of BUILD-INITIATIVE.md. Scale = epic. -->

## Intent
Define the typed interfaces and data schemas every other datum-ax epic depends on — no behavior, just
contracts plus the tests that pin them. This is Pass-1 of the dogfooded build order (contracts first).

## Requirements
- `ExecutionHost`, `InferenceClient`, and the context-firewall adapter protocols (`CodeContext`,
  `DocContext`, `NlCompressor`).
- The **eedom decision contract** (`ReviewDecision` and friends) datum-ax branches on.
- The `Ticket` / `Initiative` / `Property` / rules-registry schemas.
- Strongly typed throughout (Pydantic strict, frozen, `extra="forbid"`); enums for all state.

## Non-Goals
- Any implementation/behavior behind the protocols (that's E2–E11).
- Networking, oMLX, containers, GitHub I/O.

## Acceptance Criteria
- [ ] Every model is strict, immutable, and rejects unknown/mistyped fields.
- [ ] Every model round-trips through JSON losslessly.
- [ ] Protocols are `runtime_checkable`; a conforming fake passes `isinstance`, a non-conforming one fails.
- [ ] Documented invariants hold as Hypothesis properties (DPS-12 domains).
- [ ] `uv run pytest` is green; `mypy --strict` clean.

## Constraints & NFRs
- Python ≥3.11, Pydantic v2, Hypothesis. Src layout (`src/datum_ax`), `py.typed` shipped.

## Assumptions
- The eedom contract mirrors eedom's `ReviewDecision` surface (verified against eedom source).

## Open Questions
- [blocking? no] Pin exact pydantic/hypothesis versions now, or leave floors?

## Classification
- Complexity: Feature
- Scope: narrow
- Ambiguity: low
- Suggested route: feature
