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

## G7 increment — RED-before-GREEN gate (gap-ledger G7, ADR-0010)

Make the TDD-ordering rule a real deterministic gate (zero-token), distinct from the style gate.

- **Requirement:** `evaluate_tdd_gate(LaneVerification) -> GateResult` — GREEN (impl) is **never**
  accepted without an observed **RED** (a failing test that existed and ran first).
- **PROPERTIES (DPS-12):**
  - **Ordering (SAFETY):** a passing gate with an implementation present *implies* a test existed and
    was observed RED — GREEN can't precede RED.
  - **Determinism (INVARIANT):** same `LaneVerification` → same `GateResult`.
- **Typed shapes:** `LaneVerification` (test_present / red_observed / impl_present) and `GateResult`
  (passed / violations) — strict Pydantic.
- **Acceptance:** impl-without-test and impl-without-RED are violations; test→RED→impl passes;
  Hypothesis property proves the Ordering invariant.
- **Out of scope (needs live model):** REFLECT scoring + SKEPTIC adversarial bug-hunt (LLM) — tracked.

## Classification
- Complexity: System · Scope: wide · Ambiguity: low · Suggested route: feature
