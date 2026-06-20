"""GitHub-projection schema (ADR-0023) — the lane DAG as issue specs (the human view of the DAG)."""

from __future__ import annotations

from pydantic import Field

from datum_ax._base import Contract


class IssueSpec(Contract):
    """One issue to mirror: a stable `key`, title/body, labels, and `parent` key for sub-issues."""

    key: str = Field(min_length=1)
    title: str = Field(min_length=1)
    body: str = ""
    labels: tuple[str, ...] = ()
    parent: str | None = None


class ProjectionPlan(Contract):
    """The full set of issues mirroring an epic + its lane DAG (epic first, then sub-issues)."""

    issues: tuple[IssueSpec, ...] = ()
