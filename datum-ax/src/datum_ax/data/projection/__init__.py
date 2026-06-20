"""datum-ax issue-projection adapters (ADR-0023/0032).

`ISSUE_PROJECTORS` is the plugin registry; adapters auto-register on import. The fake projector is the
default for tests/CI; a GitHub adapter (via the GitHub MCP tools) drops in behind the same port.
"""

from __future__ import annotations

from datum_ax.contracts.projection import IssueProjector
from datum_ax.registry import Registry, autodiscover

ISSUE_PROJECTORS: Registry[IssueProjector] = Registry("issue-projector")

autodiscover(__name__, __path__)

__all__ = ["ISSUE_PROJECTORS"]
