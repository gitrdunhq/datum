"""RED tests for task-011: synthesised integration lanes draw their ids
from the same PREFIX-<n> counter as renumbered task lanes, instead of the
fixed 'task-INT-<n>' scheme.

derive_integration_lanes(invariants, tasks, test_command, prefix, start)
must emit ids matching ^DAT-\\d+$ (no 'INT' substring anywhere) when given
an explicit prefix and starting number, and must continue counting from
that start value across build_lane_plan's own renumbered task ids.

Covers (see .datum/lane-spec.json for task-011):
AC1: derive_integration_lanes(prefix, start) -> ^DAT-\\d+$ ids, no 'INT'.
AC2: numbering continues from the highest number task lanes consumed
     (task lanes end at DAT-145 -> first integration lane is DAT-146).
AC3: every emitted integration lane carries kind == 'integration' and it
     survives into build_lane_plan's output.
AC4: build_lane_plan, given two invariant groups, emits exactly two
     integration lanes with <PREFIX>-\\d+ ids, both present in
     topological_order after the task lanes they cover.
AC5: integration-lane depends_on point at the renumbered task-lane ids,
     not stale task-NNN strings.
"""

from __future__ import annotations

import re

from datum.integration_invariants import derive_integration_lanes
from datum.lane_plan import build_lane_plan

DAT_ID_PATTERN = re.compile(r"^DAT-\d+$")

PYTEST_CMD = "uv run pytest -x -q"


def _renumbered_tasks() -> dict:
    """A pretend renumbered task universe ending at DAT-145."""
    return {
        "DAT-144": {"depends_on": []},
        "DAT-145": {"depends_on": ["DAT-144"]},
    }


def _single_invariant_covering_dat_145() -> list[dict]:
    return [
        {
            "id": "INV-500",
            "invariant": "DAT-145's output stays consistent across merges",
            "covers": ["DAT-145"],
            "source": "spec:section-5",
        }
    ]


def test_ac1_derive_integration_lanes_with_explicit_prefix_and_start_emits_dat_ids():
    lanes = derive_integration_lanes(
        _single_invariant_covering_dat_145(),
        _renumbered_tasks(),
        PYTEST_CMD,
        prefix="DAT",
        start=146,
    )

    assert len(lanes) == 1
    lane = lanes[0]
    assert DAT_ID_PATTERN.match(lane["id"]), lane["id"]
    assert lane["id"] == "DAT-146"
    assert "INT" not in lane["id"]


def test_ac2_numbering_continues_from_the_supplied_start_value():
    two_groups = [
        {
            "id": "INV-500",
            "invariant": "DAT-145's output stays consistent across merges",
            "covers": ["DAT-145"],
            "source": "spec:section-5",
        },
        {
            "id": "INV-501",
            "invariant": "DAT-144's output stays isolated",
            "covers": ["DAT-144"],
            "source": "spec:section-6",
        },
    ]

    lanes = derive_integration_lanes(
        two_groups,
        _renumbered_tasks(),
        PYTEST_CMD,
        prefix="DAT",
        start=146,
    )

    ids = sorted(lane["id"] for lane in lanes)
    assert ids == ["DAT-146", "DAT-147"]
    for lane_id in ids:
        assert DAT_ID_PATTERN.match(lane_id)
        assert "INT" not in lane_id


def test_ac3_kind_is_integration_and_survives_into_build_lane_plan(tmp_path):
    tasks = [
        {
            "id": "DAT-144",
            "title": "First renumbered task",
            "files": ["src/a.py"],
            "acceptance_criteria": ["a works"],
            "red_note": "n/a",
        },
        {
            "id": "DAT-145",
            "title": "Second renumbered task",
            "files": ["src/b.py"],
            "acceptance_criteria": ["b works"],
            "red_note": "n/a",
            "depends_on": ["DAT-144"],
        },
    ]
    sorted_ids = ["DAT-144", "DAT-145"]
    ownership = {"src/a.py": "DAT-144", "src/b.py": "DAT-145"}

    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(
        "# PROPERTIES.md\n\n"
        "## Integration Invariants\n\n"
        "| ID | Invariant | Covers | Source |\n"
        "| --- | --- | --- | --- |\n"
        "| INV-500 | DAT-145's output stays consistent across merges | DAT-145 "
        "| spec:section-5 |\n"
    )

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command=PYTEST_CMD,
        properties_path=properties_path,
    )

    integration_lane_ids = [
        lid for lid, lane in plan["lanes"].items() if lane.get("kind") == "integration"
    ]
    assert len(integration_lane_ids) == 1
    int_id = integration_lane_ids[0]
    assert DAT_ID_PATTERN.match(int_id), int_id
    assert int_id == "DAT-146"
    assert plan["lanes"][int_id]["kind"] == "integration"


def test_ac4_two_invariant_groups_yield_exactly_two_prefixed_integration_lanes_after_task_lanes(
    tmp_path,
):
    tasks = [
        {
            "id": "DAT-144",
            "title": "First renumbered task",
            "files": ["src/a.py"],
            "acceptance_criteria": ["a works"],
            "red_note": "n/a",
        },
        {
            "id": "DAT-145",
            "title": "Second renumbered task",
            "files": ["src/b.py"],
            "acceptance_criteria": ["b works"],
            "red_note": "n/a",
            "depends_on": ["DAT-144"],
        },
    ]
    sorted_ids = ["DAT-144", "DAT-145"]
    ownership = {"src/a.py": "DAT-144", "src/b.py": "DAT-145"}

    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(
        "# PROPERTIES.md\n\n"
        "## Integration Invariants\n\n"
        "| ID | Invariant | Covers | Source |\n"
        "| --- | --- | --- | --- |\n"
        "| INV-500 | DAT-145's output stays consistent across merges | DAT-145 "
        "| spec:section-5 |\n"
        "| INV-501 | DAT-144's output stays isolated | DAT-144 | spec:section-6 |\n"
    )

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command=PYTEST_CMD,
        properties_path=properties_path,
    )

    integration_lane_ids = [
        lid for lid, lane in plan["lanes"].items() if lane.get("kind") == "integration"
    ]
    assert len(integration_lane_ids) == 2
    for lid in integration_lane_ids:
        assert DAT_ID_PATTERN.match(lid), lid

    order = plan["topological_order"]
    for lid, lane in plan["lanes"].items():
        if lane.get("kind") == "integration":
            for covered_task in lane["depends_on"]:
                assert order.index(lid) > order.index(covered_task)


def test_ac5_integration_lane_depends_on_point_at_renumbered_ids_not_stale_task_nnn(
    tmp_path,
):
    tasks = [
        {
            "id": "DAT-144",
            "title": "First renumbered task",
            "files": ["src/a.py"],
            "acceptance_criteria": ["a works"],
            "red_note": "n/a",
        },
        {
            "id": "DAT-145",
            "title": "Second renumbered task",
            "files": ["src/b.py"],
            "acceptance_criteria": ["b works"],
            "red_note": "n/a",
            "depends_on": ["DAT-144"],
        },
    ]
    sorted_ids = ["DAT-144", "DAT-145"]
    ownership = {"src/a.py": "DAT-144", "src/b.py": "DAT-145"}

    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(
        "# PROPERTIES.md\n\n"
        "## Integration Invariants\n\n"
        "| ID | Invariant | Covers | Source |\n"
        "| --- | --- | --- | --- |\n"
        "| INV-500 | DAT-145's output stays consistent across merges | DAT-145 "
        "| spec:section-5 |\n"
    )

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command=PYTEST_CMD,
        properties_path=properties_path,
    )

    integration_lanes = [
        lane for lane in plan["lanes"].values() if lane.get("kind") == "integration"
    ]
    assert len(integration_lanes) == 1
    depends_on = integration_lanes[0]["depends_on"]
    assert depends_on == ["DAT-145"]
    for dep in depends_on:
        assert not dep.startswith("task-"), dep
        assert dep in plan["lanes"]
