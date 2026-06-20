"""datum-ax subagent-worker adapters (ADR-0035/0032).

`WORKERS` is the plugin registry; adapter modules auto-register on import. The fake worker is the
deterministic default for tests/CI; the real tool-calling worker (GitNexus MCP + oMLX) is a
hardware-gated adapter dropped in behind this same port.
"""

from __future__ import annotations

from datum_ax.contracts.worker import Worker
from datum_ax.registry import Registry, autodiscover

WORKERS: Registry[Worker] = Registry("worker")

autodiscover(__name__, __path__)

__all__ = ["WORKERS"]
