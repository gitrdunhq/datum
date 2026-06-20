# Lane plan — E11 CLI & entry points

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 commands | `src/datum_ax/cli/main.py`, `tests/test_cli.py` | E6,E5 | 0 |
| L2 package | `src/datum_ax/cli/__init__.py` | L1 | 1 |

**Waves:** `0: commands` → `1: package`.
Strict TDD: RED (write test, watch fail) → GREEN (write implementation, watch pass).
