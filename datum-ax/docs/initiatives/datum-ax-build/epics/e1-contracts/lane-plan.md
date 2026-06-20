# Lane plan — E1 Contracts & schemas

<!-- Emulated PLAN output: DAG of lanes, disjoint files, contract-first, wave-scheduled (ADR-0010/0012). -->

| Lane | Files (disjoint owner) | depends_on | wave |
|------|------------------------|-----------|------|
| L0 scaffold | `pyproject.toml`, `src/datum_ax/__init__.py`, `src/datum_ax/_base.py`, `src/datum_ax/py.typed` | — | 0 |
| L1 properties | `src/datum_ax/schemas/properties.py`, `tests/test_properties.py` | L0 | 1 |
| L2 ticket | `src/datum_ax/schemas/ticket.py`, `tests/test_ticket.py` | L0 | 1 |
| L3 rules | `src/datum_ax/schemas/rules.py`, `tests/test_rules.py` | L0 | 1 |
| L4 review | `src/datum_ax/contracts/review.py`, `tests/test_review.py` | L0 | 1 |
| L5 execution | `src/datum_ax/contracts/execution.py`, `tests/test_execution.py` | L0 | 1 |
| L6 inference | `src/datum_ax/contracts/inference.py`, `tests/test_inference.py` | L0 | 1 |
| L7 context | `src/datum_ax/contracts/context.py`, `tests/test_context.py` | L0, L6 (uses TokenBudget) | 2 |

**Waves:** `0: L0` → `1: L1 L2 L3 L4 L5 L6` (parallel, file-disjoint) → `2: L7`.
Each lane: RED (Hypothesis property tests) → GREEN (the model/protocol) → gates. All same-wave lanes
own disjoint files, so they integrate conflict-free (ADR-0012).
