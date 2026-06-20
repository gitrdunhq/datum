# Lane plan — E4 Context firewall & DCP

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 adapters | `src/datum_ax/data/context/adapters.py` | E1 | 0 |
| L2 pruner | `src/datum_ax/data/context/dcp.py` | E1,E2 | 1 |
| L3 assembler| `src/datum_ax/data/context/assembler.py` | L1,L2 | 2 |
| L4 package | `src/datum_ax/data/context/__init__.py` | L3 | 3 |
| Tests | `tests/test_context_firewall.py` | L1..L4 | 3 |

**Waves:** `0: adapters` → `1: dcp` → `2: assembler` → `3: package + tests`.
Acceptance demo: Build a Task Packet; inject oversized output; DCP prunes to placeholders, ensuring prompt fits within budget.
