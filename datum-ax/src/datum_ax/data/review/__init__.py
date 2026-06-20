"""datum-ax review-gate adapters (ADR-0006/0032).

`REVIEW_GATES` is the plugin registry; adapter modules in this package auto-register on import. Drop a
new `*.py` here that calls `@REVIEW_GATES.register("<name>")` and it becomes available — no central
edit (open/closed).
"""

from __future__ import annotations

from datum_ax.contracts.review import ReviewGate
from datum_ax.registry import Registry, autodiscover

REVIEW_GATES: Registry[ReviewGate] = Registry("review-gate")

autodiscover(__name__, __path__)

__all__ = ["REVIEW_GATES"]
