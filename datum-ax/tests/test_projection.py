"""G9 — GitHub projection (ADR-0023): mirror the lane DAG as a human-readable epic + sub-issues with
wave:/status: labels. Pure mapping in core; an IssueProjector port publishes (fake here, GitHub-MCP
adapter later)."""

from __future__ import annotations

from datum_ax.contracts.projection import IssueProjector
from datum_ax.core.projection.dag_projection import project_dag
from datum_ax.data.projection import ISSUE_PROJECTORS
from datum_ax.data.projection.fake import FakeIssueProjector
from datum_ax.schemas.projection import ProjectionPlan

_LANES = [
    {"id": "b-lane", "description": "Build B", "files": ["src/b.py", "tests/test_b.py"]},
    {"id": "a-lane", "description": "Build A", "files": ["src/a.py"]},
]
_WAVES = [["a-lane"], ["b-lane"]]


def test_project_dag_makes_an_epic_and_sub_issues():
    plan = project_dag("My Epic", _LANES, _WAVES)
    assert isinstance(plan, ProjectionPlan)
    epic = plan.issues[0]
    assert epic.key == "epic" and epic.parent is None
    subs = [i for i in plan.issues if i.parent == "epic"]
    assert {s.key for s in subs} == {"a-lane", "b-lane"}


def test_sub_issues_carry_wave_and_status_labels():
    plan = project_dag("E", _LANES, _WAVES)
    by_key = {i.key: i for i in plan.issues}
    assert "wave:0" in by_key["a-lane"].labels and "status:pending" in by_key["a-lane"].labels
    assert "wave:1" in by_key["b-lane"].labels


def test_projection_is_deterministic():
    assert project_dag("E", _LANES, _WAVES) == project_dag("E", list(reversed(_LANES)), _WAVES)


def test_fake_projector_satisfies_port_and_publishes():
    assert isinstance(FakeIssueProjector(), IssueProjector)
    assert "fake" in ISSUE_PROJECTORS.keys()
    proj = FakeIssueProjector()
    refs = proj.publish(project_dag("E", _LANES, _WAVES))
    assert len(refs) == 3  # epic + 2 sub-issues
    assert proj.published  # it recorded the plan
