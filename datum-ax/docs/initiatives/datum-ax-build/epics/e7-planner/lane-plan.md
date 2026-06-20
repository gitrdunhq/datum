# Lane plan — E7 Planner (Phase A)

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 triage | `src/datum_ax/core/planner/triage.py`, `tests/test_triage.py` | E1,E6 | 0 |
| L2 dag | `src/datum_ax/core/planner/dag.py`, `tests/test_dag.py` | E1,E6 | 0 |
| L3 properties | `src/datum_ax/core/planner/properties.py`, `tests/test_properties.py` | L2 | 1 |
| L4 package | `src/datum_ax/core/planner/__init__.py` | L1,L2,L3 | 2 |

**Waves:** `0: triage, dag` → `1: properties` → `2: package`.
Strict TDD: For each lane, RED (write tests, watch fail) → GREEN (write implementation, watch pass).
