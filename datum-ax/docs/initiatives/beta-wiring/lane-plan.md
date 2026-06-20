# Lane plan — Beta Wiring

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L1 transport | `src/datum_ax/data/inference/transport_httpx.py` (new), `tests/test_transport.py` | none | 0 |
| L2 cli | `src/datum_ax/cli/main.py`, `tests/test_cli.py` | L1 | 1 |
| L3 graph | `src/datum_ax/core/orchestration/graph.py`, `tests/test_graph.py` | L2 | 1 |

**Waves:** `0: transport` → `1: cli & graph`.
Strict TDD: RED (write test, watch fail) → GREEN (write implementation, watch pass).
