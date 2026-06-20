# Lane plan — E10 Reviewer (Phase C)

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 adversarial | `src/datum_ax/core/reviewer/adversarial.py`, `tests/test_adversarial.py` | E6,E7,E8 | 0 |
| L2 package | `src/datum_ax/core/reviewer/__init__.py` | L1 | 1 |

**Waves:** `0: adversarial` → `1: package`.
Strict TDD: RED (write test, watch fail) → GREEN (write implementation, watch pass).
