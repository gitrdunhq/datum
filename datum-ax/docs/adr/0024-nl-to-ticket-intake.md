# ADR-0024: Natural-Language → TICKET.md Intake Skill (the front door)

## Status

Accepted (design + first built skill)

## Context

Every downstream phase assumes a **TICKET** already exists (REFINE refines it, ROUTE classifies it,
PLAN decomposes it, ADR-0023 projects it to a GitHub epic issue). But nothing turned a human's
**free-form text** into one. That is the actual front of the pipeline, and it was missing.

The input is unpredictable: it ranges from a one-liner ("tic tac toe web game") to an already
highly-structured, well-developed spec. The intake must handle the whole spectrum **without
distorting** what was asked.

This is also the **first piece worth building for real**: it is a *skill* (prompt + schema), not
infrastructure — it needs no oMLX/Valkey/MCP and runs anywhere, so it converts the markdown blueprint
into something usable today.

## Decision

Add a **`nl-to-ticket` skill** (`skills/nl-to-ticket/`) that converts arbitrary natural language into
a deterministic-shape **`TICKET.md`** (`TICKET.template.md`).

Governing rules:
- **Faithful, not inventive.** Capture exactly what was asked; never add scope. Inferences → an
  explicit **Assumptions** section; unknowns → **Open Questions** (blocking flagged). This prevents
  scope hallucination at the very front, where it would otherwise propagate through the whole run.
- **Scale to input richness.** Sparse input → short ticket + more questions; developed input → rich
  ticket + few. No padding, no truncation. Already-structured input is *mapped*, not rewritten.
- **Testable acceptance criteria.** ACs must be concrete — they seed RED tests and PROPERTIES
  (ADR-0016) downstream; vague ACs are a defect.
- **Classify for routing.** Emit Complexity / Scope / Ambiguity + a suggested ROUTE (ADR-0018) so the
  leanest pipeline shape is chosen early — a tokenomics decision made at intake (ADR-0009).
- **Deterministic schema.** A fixed section order so REFINE/PLAN can parse it.

**Place in the pipeline:**
```
free-form human text → [nl-to-ticket skill] → TICKET.md → GitHub epic issue (ADR-0023) → ROUTE → REFINE
```
The TICKET is then **human-reviewed/edited** (scope is human-owned, ADR-0023) before the deterministic
phases proceed.

## Consequences

- The pipeline gains a real, runnable entry point that exists today — the first non-markdown artifact.
- Faithful extraction contains hallucination at the source; everything downstream inherits a clean,
  honest ticket.
- Classification at intake lets ROUTE skip unneeded phases immediately (tic-tac-toe doesn't trigger
  the full System ceremony).
- The skill itself is LLM-driven (it is natural-language work) — but its **output is a structured
  artifact a human approves**, keeping a model out of the *deterministic* decision path that follows.
- The TICKET schema is now a contract shared by the skill, REFINE, PLAN, and the epic-issue
  projection; changing it is a cross-cutting change.
- Property-test targets: Confidentiality/Integrity (no invented requirements appear as stated),
  Determinism (same input → same ticket schema), Availability (even a one-word input yields a valid,
  if sparse, ticket).
</content>
