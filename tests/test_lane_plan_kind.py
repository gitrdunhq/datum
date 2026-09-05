"""Lane `kind` — the producer for the lane runner's structural fast-path.

skills/src/datum-tdd-act-lane.ts skips RED/GREEN and goes straight to
REFACTOR for structural (docs-only / config-only) lanes. Until now nothing
ever produced that flag: the runner read `lane.stage === 'structural'` while
every producer wrote the lifecycle value `stage: "queued"`, so docs-only lanes
always hit the RED count gate and failed (#369). `kind` is a distinct field so
it cannot collide with the lifecycle `stage`.
"""

import pytest

from datum.lane_plan import build_lane_plan


def _task(tid: str, **extra) -> dict:
    base = {
        "id": tid,
        "title": f"Task {tid}",
        "files": [f"docs/{tid}.md"],
        "acceptance_criteria": ["doc exists"],
        "red_note": "n/a",
    }
    base.update(extra)
    return base


def test_structural_kind_is_copied_into_the_lane():
    plan = build_lane_plan([_task("t1", kind="structural")], ["t1"], {})
    assert plan["lanes"]["t1"]["kind"] == "structural"
    # The lifecycle field is untouched by kind.
    assert plan["lanes"]["t1"]["stage"] == "queued"


def test_behavioral_kind_is_copied_into_the_lane():
    plan = build_lane_plan([_task("t1", kind="behavioral")], ["t1"], {})
    assert plan["lanes"]["t1"]["kind"] == "behavioral"


def test_absent_kind_leaves_no_kind_key_so_the_runner_defaults_to_behavioral():
    plan = build_lane_plan([_task("t1")], ["t1"], {})
    assert "kind" not in plan["lanes"]["t1"]


def test_unknown_kind_is_rejected_loudly_not_silently_dropped():
    with pytest.raises(ValueError, match="kind"):
        build_lane_plan([_task("t1", kind="docs")], ["t1"], {})
