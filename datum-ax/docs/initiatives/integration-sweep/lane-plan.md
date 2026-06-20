# Lane plan — Integration Sweep

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L0 dependency | `pyproject.toml` | none | 0 |
| L1 orchestration | `src/datum_ax/core/orchestration/graph.py`, `tests/test_graph.py` | L0 | 1 |
| L2 planner | `src/datum_ax/core/planner/triage.py`, `tests/test_triage.py` | L0 | 2 |
| L3 verifier | `src/datum_ax/core/verifier/synthesis.py`, `tests/test_synthesis.py` | L0 | 2 |

**Waves:** `0: deps` → `1: graph` → `2: integrations`.
Strict TDD: RED (write test, watch fail) → GREEN (write implementation, watch pass). No shortcuts.
