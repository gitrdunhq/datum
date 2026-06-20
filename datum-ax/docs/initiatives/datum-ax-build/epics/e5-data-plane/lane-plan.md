# Lane plan — E5 Data plane & observability

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 checkpointer | `src/datum_ax/data/state/valkey.py`, `tests/test_valkey.py` | E1 | 0 |
| L2 ledger | `src/datum_ax/data/state/ledger.py`, `tests/test_ledger.py` | E1 | 0 |
| L3 status | `src/datum_ax/data/state/status.py`, `tests/test_status.py` | E1,L1,L2 | 1 |
| L4 package | `src/datum_ax/data/state/__init__.py` | L1,L2,L3 | 2 |

**Waves:** `0: checkpointer, ledger` → `1: status` → `2: package`.
Strict TDD: For each lane, RED (write tests, watch fail) → GREEN (write implementation, watch pass).
