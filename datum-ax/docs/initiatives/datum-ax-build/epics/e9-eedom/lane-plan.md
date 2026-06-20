# Lane plan — E9 eedom gate integration

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 adapter | `src/datum_ax/core/eedom/adapter.py`, `tests/test_eedom.py` | E1 | 0 |
| L2 package | `src/datum_ax/core/eedom/__init__.py` | L1 | 1 |

**Waves:** `0: adapter` → `1: package`.
Strict TDD: RED (write test, watch fail) → GREEN (write implementation, watch pass).
