"""Widen lane-plan schema id patterns to accept `DAT-<n>` prefixed ids.

The `id` field on lanes, `topological_order` entries, and `file_ownership`
values currently only accept `task-<digits>` / `task-INT-<digits>` ids.
Github-issue-derived lane producers need to emit `DAT-<n>` ids too. This
must be a further *widening*: existing `task-<digits>` and `task-INT-<n>`
ids must keep validating exactly as before (see
tests/test_lane_plan_schema_int_ids.py), and malformed variants of the new
prefix (`dat-142`, `DAT142`, `DATUM-142`) must still be rejected.

Both datum/models/lane_plan_schema.py and datum/models/lane_schema.py must
reference a single shared datum.id_pattern.LANE_ID_PATTERN instead of an
inline r'^task-\\d+$' or r'^task-(\\d+|INT-\\d+)$' literal.
"""

import json
import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from datum.contracts import validate_payload
from datum.models.lane_plan_schema import DatumLanePlan
from datum.models.lane_schema import LanePlanEntry


def _base_plan(lane_id: str, topo_id: str, file_owner_id: str) -> dict:
    return {
        "schema_version": "1.0",
        "total_lanes": 1,
        "topological_order": [topo_id],
        "file_ownership": {"tests/integration/test_dat_142.py": file_owner_id},
        "lanes": {
            lane_id: {
                "id": lane_id,
                "title": "DAT lane",
                "files": ["tests/integration/test_dat_142.py"],
                "acceptance_criteria": ["does the thing"],
                "red_note": "n/a",
                "stage": "queued",
            }
        },
    }


def test_lane_id_dat_142_validates_via_model():
    plan = _base_plan("DAT-142", "task-001", "task-001")

    validated = DatumLanePlan.model_validate(plan)

    assert "DAT-142" in validated.lanes
    assert validated.lanes["DAT-142"].id == "DAT-142"


def test_topological_order_dat_142_validates_via_model():
    plan = _base_plan("task-001", "DAT-142", "task-001")

    validated = DatumLanePlan.model_validate(plan)

    assert str(validated.topological_order[0].root) == "DAT-142"


def test_file_ownership_dat_142_validates_via_model():
    plan = _base_plan("task-001", "task-001", "DAT-142")

    validated = DatumLanePlan.model_validate(plan)

    assert validated.file_ownership["tests/integration/test_dat_142.py"] == "DAT-142"


def test_existing_task_ids_still_validate_widening():
    plan = _base_plan("task-001", "task-001", "task-001")

    validated = DatumLanePlan.model_validate(plan)

    assert validated.lanes["task-001"].id == "task-001"


def test_existing_task_int_ids_still_validate_widening():
    plan = _base_plan("task-INT-1", "task-INT-1", "task-INT-1")

    validated = DatumLanePlan.model_validate(plan)

    assert validated.lanes["task-INT-1"].id == "task-INT-1"


@pytest.mark.parametrize(
    "malformed_id",
    ["dat-142", "DAT142", "DATUM-142"],
)
def test_malformed_dat_id_raises_validation_error_on_lane_id(malformed_id):
    plan = _base_plan(malformed_id, "task-001", "task-001")

    with pytest.raises(ValidationError):
        DatumLanePlan.model_validate(plan)


@pytest.mark.parametrize(
    "malformed_id",
    ["dat-142", "DAT142", "DATUM-142"],
)
def test_malformed_dat_id_raises_validation_error_on_topological_order(malformed_id):
    plan = _base_plan("task-001", malformed_id, "task-001")

    with pytest.raises(ValidationError):
        DatumLanePlan.model_validate(plan)


@pytest.mark.parametrize(
    "malformed_id",
    ["dat-142", "DAT142", "DATUM-142"],
)
def test_malformed_dat_id_raises_validation_error_on_file_ownership(malformed_id):
    plan = _base_plan("task-001", "task-001", malformed_id)

    with pytest.raises(ValidationError):
        DatumLanePlan.model_validate(plan)


def test_lane_schema_accepts_dat_142_id():
    entry = LanePlanEntry.model_validate(
        {
            "id": "DAT-142",
            "files": ["tests/integration/test_dat_142.py"],
            "acceptance_criteria": ["does the thing"],
            "red_note": "n/a",
        }
    )

    assert entry.id == "DAT-142"


def test_lane_schema_rejects_lowercase_dat_id():
    with pytest.raises(ValidationError):
        LanePlanEntry.model_validate(
            {
                "id": "dat-142",
                "files": ["tests/integration/test_dat_142.py"],
                "acceptance_criteria": ["does the thing"],
                "red_note": "n/a",
            }
        )


def test_no_inline_task_id_literal_remains_and_shared_pattern_referenced():
    from datum.id_pattern import LANE_ID_PATTERN

    assert LANE_ID_PATTERN is not None

    repo_root = Path(__file__).resolve().parents[1]
    lane_plan_source = (
        repo_root / "datum" / "models" / "lane_plan_schema.py"
    ).read_text()
    lane_schema_source = (repo_root / "datum" / "models" / "lane_schema.py").read_text()

    inline_task_literal = re.compile(r"task-\\\\?d\+|task-\(\\\\?d\+\|INT-\\\\?d\+\)")

    for source in (lane_plan_source, lane_schema_source):
        assert not inline_task_literal.search(source)
        assert "datum.id_pattern" in source or "from datum import id_pattern" in source


def test_validate_payload_accepts_dat_142_plan(tmp_path):
    plan = _base_plan("DAT-142", "DAT-142", "DAT-142")
    payload_path = tmp_path / "plan.json"
    payload_path.write_text(json.dumps(plan))

    errors = validate_payload("lane-plan.schema.json", payload_path)

    assert errors == []
