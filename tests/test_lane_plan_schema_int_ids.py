"""Widen lane-plan schema id patterns to accept `task-INT-<n>`.

The `id` field on lanes, `topological_order` entries, and `file_ownership`
values currently only accept plain `task-<digits>` ids. Integration-lane
producers need to emit `task-INT-<n>` ids too. This must be a *widening*:
ordinary `task-<digits>` ids must keep validating exactly as before, and
malformed variants (missing digits, wrong casing, extra suffixes, etc.)
must still be rejected.
"""

import json

import pytest
from pydantic import ValidationError

from datum.contracts import validate_payload
from datum.models.lane_plan_schema import DatumLanePlan


def _base_plan(lane_id: str, topo_id: str, file_owner_id: str) -> dict:
    return {
        "schema_version": "1.0",
        "total_lanes": 1,
        "topological_order": [topo_id],
        "file_ownership": {"tests/integration/test_int_1.py": file_owner_id},
        "lanes": {
            lane_id: {
                "id": lane_id,
                "title": "Integration lane",
                "files": ["tests/integration/test_int_1.py"],
                "acceptance_criteria": ["does the thing"],
                "red_note": "n/a",
                "stage": "queued",
            }
        },
    }


def test_lane_id_task_int_1_validates_through_validate_payload(tmp_path):
    plan = _base_plan("task-INT-1", "task-001", "task-001")
    payload_path = tmp_path / "plan.json"
    payload_path.write_text(json.dumps(plan))

    errors = validate_payload("lane-plan.schema.json", payload_path)

    assert errors == []


def test_topological_order_task_int_2_validates_through_validate_payload(tmp_path):
    plan = _base_plan("task-001", "task-INT-2", "task-001")
    payload_path = tmp_path / "plan.json"
    payload_path.write_text(json.dumps(plan))

    errors = validate_payload("lane-plan.schema.json", payload_path)

    assert errors == []


def test_file_ownership_task_int_1_validates_through_validate_payload(tmp_path):
    plan = _base_plan("task-001", "task-001", "task-INT-1")
    payload_path = tmp_path / "plan.json"
    payload_path.write_text(json.dumps(plan))

    errors = validate_payload("lane-plan.schema.json", payload_path)

    assert errors == []


def test_ordinary_task_ids_still_validate_exactly_as_before(tmp_path):
    plan = _base_plan("task-001", "task-001", "task-001")
    payload_path = tmp_path / "plan.json"
    payload_path.write_text(json.dumps(plan))

    errors = validate_payload("lane-plan.schema.json", payload_path)

    assert errors == []


@pytest.mark.parametrize(
    "malformed_id",
    [
        "task-abc",
        "task-INT-",
        "task-INT-x",
        "taskINT-1",
        "task-INT-1-extra",
    ],
)
def test_malformed_ids_still_raise_validation_error_on_lane_id(malformed_id):
    plan = _base_plan(malformed_id, "task-001", "task-001")

    with pytest.raises(ValidationError):
        DatumLanePlan.model_validate(plan)


@pytest.mark.parametrize(
    "malformed_id",
    [
        "task-abc",
        "task-INT-",
        "task-INT-x",
        "taskINT-1",
        "task-INT-1-extra",
    ],
)
def test_malformed_ids_still_raise_validation_error_on_topological_order(malformed_id):
    plan = _base_plan("task-001", malformed_id, "task-001")

    with pytest.raises(ValidationError):
        DatumLanePlan.model_validate(plan)


@pytest.mark.parametrize(
    "malformed_id",
    [
        "task-abc",
        "task-INT-",
        "task-INT-x",
        "taskINT-1",
        "task-INT-1-extra",
    ],
)
def test_malformed_ids_still_raise_validation_error_on_file_ownership(malformed_id):
    plan = _base_plan("task-001", "task-001", malformed_id)

    with pytest.raises(ValidationError):
        DatumLanePlan.model_validate(plan)


# Assumption 8 (#514): TASK is an ordinary four-letter prefix — the old
# per-epic scheme rejected it only because it had no prefixes at all.
def test_task_prefixed_id_is_now_a_valid_lane_id():
    plan = _base_plan("TASK-001", "TASK-001", "TASK-001")

    DatumLanePlan.model_validate(plan)
