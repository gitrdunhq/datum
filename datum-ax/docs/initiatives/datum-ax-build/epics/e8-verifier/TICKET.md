# TICKET: E8 — Verifier (Phase B)

## Intent
Execute the 3-attempt RED/GREEN verification loop (ADR-0007). Synthesize tests, ensure they fail, synthesize the implementation, ensure they pass, and enforce code discipline gates (ADR-0010) via static AST parsing before handing over to eedom.

## Requirements
- `VerificationLoop`: Manages the retry counter (up to 3 attempts). Controls the sequence: Synthesize RED -> Verify RED -> Synthesize GREEN -> Verify GREEN -> Code Discipline.
- `Synthesis`: Sub-components to generate tests and implementation code. (Stubbed inference calls).
- `DisciplineGate`: AST parser that checks for missing docstrings, missing type hints, or bad dependencies, acting as a zero-token deterministic verifier.

## Acceptance Criteria
- [ ] `VerificationLoop` fails fast if 3 attempts are exhausted.
- [ ] `VerificationLoop` routes properly on a successful RED -> GREEN sequence.
- [ ] `DisciplineGate` accurately parses dummy AST nodes to flag missing docstrings or type hints.
- [ ] Strict TDD followed.
- [ ] `uv run pytest` green; tier-boundary guard passes.

## Constraints & NFRs
- `core` tier implementation (`src/datum_ax/core/verifier`).
- Pydantic models for gate verdicts. Use `ast` standard library for discipline checking.

## Classification
- Complexity: System · Scope: wide · Ambiguity: low · Suggested route: feature
