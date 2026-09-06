"""Wire INT lanes (derived from PROPERTIES.md '## Integration Invariants')
into build_lane_plan's output, plus a `--properties` CLI passthrough.

build_lane_plan(..., properties_path=None) must:
  - be byte-identical to the current (pre-slice) output when properties_path
    is None or the PROPERTIES.md has an empty invariants table (AC1, AC8.1)
  - otherwise add one task-INT-<n> lane per merge frontier from
    datum.integration_invariants.derive_integration_lanes, append each INT
    lane id to topological_order after its covered tasks, add its single
    test file to file_ownership, and roll it into total_lanes (AC2-AC5)
  - keep the resulting plan valid against DatumLanePlan (AC7)

main() must accept an optional --properties argument that flows through
unchanged when omitted (AC8).

AC4.1 CONFLICT (see lane-spec red_note): a pre-slice plan with no `kind` on
any lane must digest byte-identically with NO synthesized `kind` key. We
assert that directly rather than assuming a "task" default.
"""

from __future__ import annotations

import json
import sys

import pytest
from pydantic import ValidationError

from datum.lane_plan import (
    build_file_ownership,
    build_lane_plan,
    main,
    topological_sort,
)
from datum.lane_plan_digest import build_digest
from datum.models.lane_plan_schema import DatumLanePlan


def _tasks() -> list[dict]:
    return [
        {
            "id": "task-001",
            "title": "First task",
            "files": ["src/a.py"],
            "acceptance_criteria": ["a works"],
            "red_note": "n/a",
        },
        {
            "id": "task-002",
            "title": "Second task",
            "files": ["src/b.py"],
            "acceptance_criteria": ["b works"],
            "red_note": "n/a",
            "depends_on": ["task-001"],
        },
    ]


def _plan_args():
    tasks = _tasks()
    sorted_ids = topological_sort(tasks)
    ownership, _ = build_file_ownership(tasks)
    return tasks, sorted_ids, ownership


_PROPERTIES_WITH_INVARIANT = """# PROPERTIES.md

## Integration Invariants

| ID | Invariant | Covers | Source |
| --- | --- | --- | --- |
| INV-001 | Something holds across the merge | task-001 | spec:section-1 |
"""

_PROPERTIES_EMPTY_TABLE = """# PROPERTIES.md

## Integration Invariants

| ID | Invariant | Covers | Source |
| --- | --- | --- | --- |
"""


def test_ac1_properties_path_none_is_byte_identical_to_pre_slice_output():
    tasks, sorted_ids, ownership = _plan_args()

    baseline = build_lane_plan(
        tasks, sorted_ids, ownership, global_test_command="uv run pytest -x -q"
    )
    with_none = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command="uv run pytest -x -q",
        properties_path=None,
    )

    assert json.dumps(with_none, sort_keys=True) == json.dumps(baseline, sort_keys=True)
    # AC4.1: no lane in the pre-slice plan gets a synthesized `kind` key —
    # the digest must NOT invent a "task" default for absent kind.
    assert all("kind" not in lane for lane in baseline["lanes"].values())
    digest = build_digest(baseline, "deadbeef")
    assert all("kind" not in entry for entry in digest["lanes"].values())


def test_ac2_properties_with_invariants_adds_one_int_lane_per_merge_frontier(tmp_path):
    tasks, sorted_ids, ownership = _plan_args()
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_PROPERTIES_WITH_INVARIANT)

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command="uv run pytest -x -q",
        properties_path=properties_path,
    )

    assert "task-INT-1" in plan["lanes"]
    int_lane = plan["lanes"]["task-INT-1"]
    assert int_lane["kind"] == "integration"
    assert int_lane["expect_tests_pass"] is True


def test_ac3_int_lane_id_appended_to_topological_order_after_covered_tasks(tmp_path):
    tasks, sorted_ids, ownership = _plan_args()
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_PROPERTIES_WITH_INVARIANT)

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command="uv run pytest -x -q",
        properties_path=properties_path,
    )

    order = plan["topological_order"]
    assert order.index("task-INT-1") > order.index("task-001")


def test_ac4_int_lane_test_file_added_to_file_ownership(tmp_path):
    tasks, sorted_ids, ownership = _plan_args()
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_PROPERTIES_WITH_INVARIANT)

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command="uv run pytest -x -q",
        properties_path=properties_path,
    )

    assert plan["file_ownership"]["tests/integration/test_int_1.py"] == "task-INT-1"


def test_ac5_total_lanes_equals_len_lanes_including_int_lanes(tmp_path):
    tasks, sorted_ids, ownership = _plan_args()
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_PROPERTIES_WITH_INVARIANT)

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command="uv run pytest -x -q",
        properties_path=properties_path,
    )

    assert plan["total_lanes"] == len(plan["lanes"]) == 3


def test_ac6_empty_invariants_table_produces_zero_int_lanes_and_matches_none(tmp_path):
    tasks, sorted_ids, ownership = _plan_args()
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_PROPERTIES_EMPTY_TABLE)

    baseline = build_lane_plan(
        tasks, sorted_ids, ownership, global_test_command="uv run pytest -x -q"
    )
    with_empty_table = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command="uv run pytest -x -q",
        properties_path=properties_path,
    )

    assert not any(lid.startswith("task-INT-") for lid in with_empty_table["lanes"])
    assert json.dumps(with_empty_table, sort_keys=True) == json.dumps(
        baseline, sort_keys=True
    )


def test_ac7_plan_with_int_lanes_validates_against_datum_lane_plan_schema(tmp_path):
    tasks, sorted_ids, ownership = _plan_args()
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_PROPERTIES_WITH_INVARIANT)

    plan = build_lane_plan(
        tasks,
        sorted_ids,
        ownership,
        global_test_command="uv run pytest -x -q",
        properties_path=properties_path,
    )

    try:
        validated = DatumLanePlan.model_validate(plan)
    except ValidationError as exc:  # pragma: no cover - assertion path
        pytest.fail(f"INT-lane plan failed schema validation: {exc}")
    assert "task-INT-1" in validated.lanes


def test_ac8_main_accepts_optional_properties_argument(tmp_path, monkeypatch):
    tasks = _tasks()
    input_path = tmp_path / "tasks.json"
    input_path.write_text(json.dumps(tasks))
    properties_path = tmp_path / "PROPERTIES.md"
    properties_path.write_text(_PROPERTIES_WITH_INVARIANT)
    output_path = tmp_path / "lane-plan.json"
    md_output_path = tmp_path / "TASKS.md"

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "lane_plan.py",
            "--input",
            str(input_path),
            "--output",
            str(output_path),
            "--md-output",
            str(md_output_path),
            "--properties",
            str(properties_path),
        ],
    )

    main()

    written = json.loads(output_path.read_text())
    assert "task-INT-1" in written["lanes"]
