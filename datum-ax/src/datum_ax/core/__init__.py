"""datum-ax CORE tier — orchestration logic (graph, planner, loop, gates, routing).

IMPORT RULE (ADR-0026, enforced by tests/test_architecture.py):
may import ONLY ``datum_ax.contracts`` and ``datum_ax.schemas``. NEVER ``data`` or
``presentation``. Concrete I/O is injected as ``contracts`` Protocols (dependency inversion).
Empty until E6+ (orchestration).
"""
