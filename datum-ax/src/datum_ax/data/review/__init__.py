"""datum-ax review-gate adapters (ADR-0006/0032).

`REVIEW_GATES` is the plugin registry; adapter modules in this package auto-register on import. Drop a
new `*.py` here that calls `@REVIEW_GATES.register("<name>")` and it becomes available — no central
edit (open/closed).
"""

from __future__ import annotations

import importlib
import pkgutil

from datum_ax.contracts.review import ReviewGate
from datum_ax.registry import Registry

REVIEW_GATES: Registry[ReviewGate] = Registry("review-gate")

# Auto-discover adapter modules so they self-register (plugin drop-in).
for _module in pkgutil.iter_modules(__path__):
    if not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

__all__ = ["REVIEW_GATES"]
