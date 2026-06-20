# Lane plan — E8 Verifier (Phase B)

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 synthesis | `src/datum_ax/core/verifier/synthesis.py`, `tests/test_synthesis.py` | E3,E4 | 0 |
| L2 discipline | `src/datum_ax/core/verifier/discipline.py`, `tests/test_discipline.py` | E4 | 0 |
| L3 loop | `src/datum_ax/core/verifier/loop.py`, `tests/test_loop.py` | L1,L2,E6 | 1 |
| L4 package | `src/datum_ax/core/verifier/__init__.py` | L3 | 2 |

**Waves:** `0: synthesis, discipline` → `1: loop` → `2: package`.
Strict TDD: For each lane, RED (write tests, watch fail) → GREEN (write implementation, watch pass).
