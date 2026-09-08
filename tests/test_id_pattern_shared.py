"""Tests for #523: a single-source lane id pattern (``datum.id_pattern``)
that accepts ``task-N``, ``task-INT-N`` and short-prefix ids like ``DAT-142``,
shared by the JSON schema and the pydantic model."""

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

from datum.path_utils import assets_dir

ACCEPTED_IDS = ["task-1", "task-001", "task-INT-1", "DAT-142", "AB-1", "ABCDEF-9"]
REJECTED_IDS = [
    "DAT142",
    "dat-142",
    "DATUM-142",
    "task-",
    "task-INT-",
    "DAT-",
    "DAT-1x",
]


class TestLaneIdPatternConstant:
    def test_lane_id_pattern_is_anchored_and_accepts_all_shapes(self):
        from datum.id_pattern import LANE_ID_PATTERN

        assert isinstance(LANE_ID_PATTERN, str)
        assert LANE_ID_PATTERN.startswith("^")
        assert LANE_ID_PATTERN.endswith("$")
        for value in ACCEPTED_IDS:
            assert re.fullmatch(LANE_ID_PATTERN, value), f"{value!r} should match"

    @pytest.mark.parametrize("bad", REJECTED_IDS)
    def test_lane_id_pattern_rejects_malformed_ids(self, bad):
        from datum.id_pattern import LANE_ID_PATTERN

        assert re.fullmatch(LANE_ID_PATTERN, bad) is None


class TestIsLaneId:
    def test_is_lane_id_true_for_valid_short_prefix_id(self):
        from datum.id_pattern import is_lane_id

        assert is_lane_id("DAT-142") is True

    def test_is_lane_id_false_for_lowercase_prefix(self):
        from datum.id_pattern import is_lane_id

        assert is_lane_id("dat-142") is False


class TestSchemaSharesPattern:
    def test_task_schema_id_and_depends_on_pattern_match_shared_constant(self):
        from datum.id_pattern import LANE_ID_PATTERN

        schema = json.loads((assets_dir() / "schemas/task.schema.json").read_text())
        assert schema["$defs"]["laneId"]["pattern"] == LANE_ID_PATTERN
        assert schema["properties"]["id"] == {"$ref": "#/$defs/laneId"}
        assert schema["properties"]["depends_on"]["items"] == {"$ref": "#/$defs/laneId"}

    def test_python_side_carries_no_pattern_literal_of_its_own(self):
        """Review ARCH-001/CORR-003: task.schema.json is the ONLY place the
        pattern is written; datum/id_pattern.py loads it, never restates it."""
        import datum.id_pattern as mod

        source = Path(mod.__file__).read_text(encoding="utf-8")
        assert "[A-Z]" not in source
        assert "task.schema.json" in source

    def test_packaged_schema_copy_matches_the_consumed_one(self):
        root = assets_dir().parent
        consumed = (root / "assets/schemas/task.schema.json").read_text()
        packaged = (root / "datum/assets/schemas/task.schema.json").read_text()
        assert packaged == consumed


class TestDatumTaskAcceptsWidenedIds:
    def test_datum_task_constructs_with_short_prefix_id(self):
        from datum.models.task_schema import DatumTask

        task = DatumTask(
            id="DAT-142",
            slug="x-y-z",
            title="t",
            acceptance_criteria=["a"],
            files=["a"],
            depends_on=["DAT-141"],
            red_note="n",
        )
        assert task.id == "DAT-142"
        assert task.depends_on == ["DAT-141"]

    def test_datum_task_rejects_lowercase_short_prefix_id(self):
        from datum.models.task_schema import DatumTask

        with pytest.raises(ValidationError):
            DatumTask(
                id="dat-142",
                slug="x-y-z",
                title="t",
                acceptance_criteria=["a"],
                files=["a"],
                depends_on=[],
                red_note="n",
            )

    def test_datum_task_still_constructs_with_legacy_task_nnn_id(self):
        from datum.models.task_schema import DatumTask

        task = DatumTask(
            id="task-001",
            slug="x-y-z",
            title="t",
            acceptance_criteria=["a"],
            files=["a"],
            depends_on=["task-002"],
            red_note="n",
        )
        assert task.id == "task-001"
        assert task.depends_on == ["task-002"]


class TestLanePlanValidateAcceptsShortPrefixIds:
    def test_lane_plan_validate_exits_zero_for_short_prefix_ids(self, tmp_path):
        tasks = [
            {
                "id": "DAT-142",
                "title": "First",
                "acceptance_criteria": ["a"],
                "files": ["a.py"],
                "red_note": "n",
            },
            {
                "id": "DAT-143",
                "title": "Second",
                "acceptance_criteria": ["b"],
                "files": ["b.py"],
                "depends_on": ["DAT-142"],
                "red_note": "n",
            },
        ]
        tasks_path = tmp_path / "tasks.json"
        tasks_path.write_text(json.dumps(tasks))

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.lane_plan",
                "--validate",
                "--input",
                str(tasks_path),
            ],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, result.stdout + result.stderr
        payload = json.loads(result.stdout.strip().splitlines()[-1])
        assert payload == {"valid": True, "task_count": 2}
