"""datum-ax subagent-worker adapters (ADR-0035/0032).

`WORKERS` is the plugin registry; adapter modules auto-register on import. The fake worker is the
deterministic default for tests/CI; the real tool-calling worker (GitNexus MCP + oMLX) is a
hardware-gated adapter dropped in behind this same port.
"""

from __future__ import annotations

import importlib
import pkgutil

from datum_ax.contracts.worker import Worker
from datum_ax.registry import Registry

WORKERS: Registry[Worker] = Registry("worker")

for _module in pkgutil.iter_modules(__path__):
    if not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

__all__ = ["WORKERS"]
