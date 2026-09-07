"""Tests for gate_plan()'s zero-lane guard.

Correctness bug (found via correctness audit): a lane-plan.json with
`lanes: {}` passed gate_plan() silently — set(topological_order) != lane_ids
is False when both sides are empty, so the lane-validation loop never runs
and no error is raised. A trivial/no-op ticket scoped down to zero tasks by
the decomposition agent would proceed into Act with nothing to do, instead
of failing the Plan gate with a clear message.
"""

from datum.gate import check_zero_lanes


def test_zero_lanes_fails():
    lane_plan = {"lanes": {}, "topological_order": []}
    errors = check_zero_lanes(lane_plan)
    assert len(errors) == 1
    assert "zero lanes" in errors[0].lower()


def test_nonzero_lanes_passes():
    lane_plan = {"lanes": {"lane-a": {}}, "topological_order": ["lane-a"]}
    assert check_zero_lanes(lane_plan) == []
