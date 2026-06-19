# ADR-0027: Dual Artifacts — Markdown for Humans, JSON for Machines

## Status

Accepted (design + enforced by the E1 schemas)

## Context

Every pipeline artifact (TICKET, INITIATIVE, lane-plan, PROPERTIES, review decision, rules-registry
entry, run ledger record) has two audiences: **humans**, who want readable Markdown, and **machines**,
which need to verify completion and detect a wrong handoff. Prose can't be validated; a phase that
"looks done" in Markdown may be malformed for the next phase.

## Decision

**Every artifact exists in two forms; the JSON is canonical for machines, the Markdown is the human
view — and the JSON validates against its contract.**

- **JSON is the machine contract.** Each artifact has a strict Pydantic schema (the E1 `schemas`/
  `contracts`). A machine reading an artifact does `Model.model_validate_json(...)`: it **passes**
  (handoff correct) or **raises** (handoff wrong) — deterministically, no LLM.
- **Markdown is the human projection**, rendered from / kept consistent with the JSON (e.g. the
  GitHub epic issue body, ADR-0023; `TICKET.md` alongside `ticket.json`).
- **Handoff verification = schema validation at every boundary.** "Is this phase done / is the
  handoff valid?" is answered by validating the next phase's input JSON against its contract (ADR-0026
  "contract at every handoff" becomes literally executable).
- **Schemas ship JSON Schema** (`model_json_schema()`) so artifacts can be validated by any tool, and
  the contract is publishable.

## Consequences

- Completion and correctness are machine-checkable, not eyeballed; a wrong handoff fails fast at the
  boundary instead of corrupting a later phase.
- The intake skill emits both (`nl-to-ticket` → `TICKET.md` + `ticket.json`); same for INITIATIVE and
  the lane plan.
- Markdown and JSON must not drift — JSON is the source of truth; Markdown is generated or validated
  against it (never the reverse).
- The E1 boundary models already provide this: strict, round-trip-safe, JSON-Schema-emitting; the
  `tests/test_artifacts.py` properties prove it.
- Property-test targets: Determinism (JSON round-trips losslessly), Integrity (a malformed handoff is
  rejected).
</content>
