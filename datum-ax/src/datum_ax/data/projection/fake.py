"""FakeIssueProjector — deterministic projector for tests/CI (ADR-0023).

Records the plan and returns a synthetic ref per issue instead of calling GitHub. The real adapter
(GitHub MCP: create epic issue + sub-issues, apply wave:/status: labels, sync) drops in behind the
same `IssueProjector` port.
"""

from __future__ import annotations

from typing import Any

from datum_ax.data.projection import ISSUE_PROJECTORS
from datum_ax.schemas.projection import ProjectionPlan


class FakeIssueProjector:
    """Implements the `IssueProjector` port without a network."""

    def __init__(self) -> None:
        self.published: list[ProjectionPlan] = []

    def publish(self, plan: ProjectionPlan) -> tuple[str, ...]:
        self.published.append(plan)
        return tuple(f"fake://issue/{spec.key}" for spec in plan.issues)


@ISSUE_PROJECTORS.register("fake")
def _build(**kwargs: Any) -> FakeIssueProjector:
    return FakeIssueProjector()
