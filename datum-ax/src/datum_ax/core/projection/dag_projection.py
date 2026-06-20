"""Project a lane DAG into issue specs (ADR-0023). Pure + deterministic.

One epic issue plus one sub-issue per lane, each labelled with its wave and a `status:pending` chip —
the human-readable mirror of the DAG. Publishing the plan is a separate port (IssueProjector).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from datum_ax.schemas.projection import IssueSpec, ProjectionPlan


def project_dag(
    epic_title: str,
    lanes: Sequence[Mapping[str, object]],
    waves: Sequence[Sequence[str]],
) -> ProjectionPlan:
    """Map ``(epic, lanes, waves)`` → an epic issue + one sub-issue per lane (deterministic)."""
    wave_of = {lane_id: wi for wi, wave in enumerate(waves) for lane_id in wave}
    issues = [
        IssueSpec(
            key="epic",
            title=epic_title,
            body=f"Epic with {len(lanes)} lanes across {len(waves)} waves.",
            labels=("epic",),
            parent=None,
        )
    ]
    for lane in sorted(lanes, key=lambda lane_dict: str(lane_dict.get("id"))):
        lane_id = str(lane.get("id"))
        files = lane.get("files") or []
        # A lane present in `lanes` but absent from every wave is unscheduled — label it distinctly,
        # not as a (genuine) first wave. (review #8)
        wave_label = f"wave:{wave_of[lane_id]}" if lane_id in wave_of else "wave:unscheduled"
        issues.append(
            IssueSpec(
                key=lane_id,
                title=str(lane.get("description") or lane_id),
                body="Files: " + ", ".join(str(f) for f in files),
                labels=(wave_label, "status:pending"),
                parent="epic",
            )
        )
    return ProjectionPlan(issues=tuple(issues))
