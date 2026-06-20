# Lane plan — E6 Orchestration core

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 state | `src/datum_ax/core/orchestration/state.py`, `tests/test_state.py` | E1 | 0 |
| L2 scheduler | `src/datum_ax/core/orchestration/scheduler.py`, `tests/test_scheduler.py` | L1 | 1 |
| L3 graph | `src/datum_ax/core/orchestration/graph.py`, `tests/test_graph.py` | L1,L2,E5 | 2 |
| L4 package | `src/datum_ax/core/orchestration/__init__.py` | L3 | 3 |

**Waves:** `0: state` → `1: scheduler` → `2: graph` → `3: package`.
Strict TDD: For each lane, RED (write tests, watch fail) → GREEN (write implementation, watch pass).
