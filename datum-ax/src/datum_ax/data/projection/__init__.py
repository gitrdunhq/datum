"""datum-ax issue-projection adapters (ADR-0023/0032).

`ISSUE_PROJECTORS` is the plugin registry; adapters auto-register on import. The fake projector is the
default for tests/CI; a GitHub adapter (via the GitHub MCP tools) drops in behind the same port.
"""

from __future__ import annotations

import importlib
import pkgutil

from datum_ax.contracts.projection import IssueProjector
from datum_ax.registry import Registry

ISSUE_PROJECTORS: Registry[IssueProjector] = Registry("issue-projector")

for _module in pkgutil.iter_modules(__path__):
    if not _module.name.startswith("_"):
        importlib.import_module(f"{__name__}.{_module.name}")

__all__ = ["ISSUE_PROJECTORS"]
