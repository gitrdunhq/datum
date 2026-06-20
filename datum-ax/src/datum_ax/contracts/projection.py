"""IssueProjector port (ADR-0023/0032) — publish a ProjectionPlan to an issue tracker.

The plan (epic + sub-issues, computed in `core`) is published by an adapter: a fake for tests/CI, a
GitHub-MCP adapter later. `publish` returns a ref per issue (url/id). Presentation wires the adapter.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from datum_ax.schemas.projection import ProjectionPlan


@runtime_checkable
class IssueProjector(Protocol):
    def publish(self, plan: ProjectionPlan) -> tuple[str, ...]: ...
