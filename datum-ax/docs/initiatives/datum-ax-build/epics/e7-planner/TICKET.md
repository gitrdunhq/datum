# TICKET: E7 — Planner (Phase A)

## Intent
Transform a TICKET into a fully actionable lane DAG. Implement the Phase A components: deterministic triage, DAG decomposition ensuring disjoint-file waves and contract-first ordering, and PROPERTIES derivation.

## Requirements
- `TriageNode`: Analyzes ticket metadata to select target hosts and model tiers deterministically.
- `DAGBuilder`: 
  - Decomposes the task into individual lanes.
  - Groups lanes into execution waves.
  - Validates that files within the same wave are strictly disjoint (no concurrent modifications).
  - Enforces context-budget lane sizing (splits oversized lanes into multiple lanes).
- `PropertiesGenerator`: Derives the DPS-12 taxonomy properties to enforce invariants on the output.

## Acceptance Criteria
- [ ] `DAGBuilder` takes a list of lanes and successfully groups them into waves.
- [ ] `DAGBuilder` correctly flags or prevents a wave from containing multiple lanes editing the same file.
- [ ] `DAGBuilder` splits an oversized lane (too many files/tokens) into separate lanes.
- [ ] `TriageNode` reliably produces standard classification routes.
- [ ] Strict TDD followed (RED tests first, then GREEN implementation).
- [ ] `uv run pytest` green; tier-boundary guard passes.

## Constraints & NFRs
- `core` tier implementation (`src/datum_ax/core/planner`).
- Follow strict Pydantic structures. Use stubs for ML responses where actual model calls would be needed.

## Classification
- Complexity: System · Scope: wide · Ambiguity: medium · Suggested route: feature
