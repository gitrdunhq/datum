# TICKET: E9 — eedom gate integration

## Intent
Connect the `datum-ax` orchestrator to the `eedom` deterministic review gate. This requires translating internal properties (DPS-12) to the `eedom` context schema, invoking the `eedom evaluate` CLI, and securely parsing the resulting verdict.

## Requirements
- `EedomAdapter`: Manages the translation and Subprocess boundary.
- **Schema Translation**: Maps `datum` properties into the input expected by `eedom`.
- **Verdict Parsing**: Runs `eedom evaluate --json` (stubbed for tests) and reliably parses a PASS or FAIL verdict and captures rule violations.

## Acceptance Criteria
- [ ] `EedomAdapter` successfully maps internal properties to the eedom schema.
- [ ] A simulated "bad" diff returns a parsed FAIL verdict with violation details.
- [ ] A simulated "good" diff returns a parsed PASS verdict.
- [ ] Strict TDD followed.
- [ ] `uv run pytest` green; tier-boundary guard passes.

## Constraints & NFRs
- `core` tier implementation (`src/datum_ax/core/eedom`).
- Because `eedom` is an external binary, the adapter must handle subprocess mock injection or execute a dummy script during unit tests.

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
