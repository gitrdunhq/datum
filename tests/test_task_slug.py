"""Regression tests for #352: task ids are ``task-NNN`` and the descriptive
name lives in an optional ``slug`` field that is carried through the lane
plan, TASKS.md, and the skeleton preflight output."""

import json

import pytest
from pydantic import ValidationError

from datum.lane_plan import build_file_ownership, build_lane_plan, render_tasks_md
from datum.models.lane_plan_schema import DatumLanePlan
from datum.models.task_schema import DatumTask
from datum.models.tasks_schema import DatumTaskList
from datum.path_utils import assets_dir


def _task(**overrides) -> dict:
    base = {
        "id": "task-001",
        "title": "Add cycle detection",
        "acceptance_criteria": ["assertAcyclicTasks raises on a->b->a"],
        "files": ["skills/src/shared/utils.ts", "skills/src/shared/utils.test.ts"],
        "red_note": "call assertAcyclicTasks with a cycle",
    }
    base.update(overrides)
    return base


class TestDatumTaskSlug:
    def test_accepts_task_nnn_id_with_slug(self):
        task = DatumTask.model_validate(_task(slug="add-cycle-detection"))
        assert task.id == "task-001"
        assert task.slug == "add-cycle-detection"

    def test_slug_is_optional(self):
        task = DatumTask.model_validate(_task())
        assert task.slug is None

    @pytest.mark.parametrize(
        "bad",
        ["Add-Cycle", "ab", "-leading-dash", "has space", "under_score", "x" * 62],
    )
    def test_rejects_malformed_slug(self, bad):
        with pytest.raises(ValidationError):
            DatumTask.model_validate(_task(slug=bad))

    def test_descriptive_id_still_rejected(self):
        # The id pattern is unchanged: the descriptive name belongs in slug.
        with pytest.raises(ValidationError):
            DatumTask.model_validate(_task(id="add-cycle-detection"))

    def test_task_list_accepts_slugged_tasks(self):
        DatumTaskList.model_validate([_task(slug="add-cycle-detection")])

    def test_json_schema_declares_slug_pattern(self):
        schema = json.loads((assets_dir() / "schemas/task.schema.json").read_text())
        assert schema["properties"]["slug"]["pattern"] == "^[a-z0-9][a-z0-9-]{2,60}$"


class TestLanePlanCarriesSlug:
    def _plan(self):
        tasks = [
            _task(slug="add-cycle-detection"),
            _task(
                id="task-002",
                slug="validate-input-schema",
                files=["datum/lane_plan.py", "tests/test_x.py"],
                depends_on=["task-001"],
            ),
        ]
        ownership, _ = build_file_ownership(tasks)
        return tasks, build_lane_plan(tasks, ["task-001", "task-002"], ownership)

    def test_lane_plan_lane_has_slug(self):
        _, plan = self._plan()
        assert plan["lanes"]["task-001"]["slug"] == "add-cycle-detection"
        assert plan["lanes"]["task-002"]["slug"] == "validate-input-schema"

    def test_lane_plan_validates_against_model_with_slug(self):
        _, plan = self._plan()
        parsed = DatumLanePlan.model_validate(plan)
        assert parsed.lanes["task-001"].slug == "add-cycle-detection"

    def test_lane_without_slug_omits_key(self):
        tasks = [_task()]
        ownership, _ = build_file_ownership(tasks)
        plan = build_lane_plan(tasks, ["task-001"], ownership)
        assert "slug" not in plan["lanes"]["task-001"]

    def test_tasks_md_renders_slug(self):
        tasks, _ = self._plan()
        md = render_tasks_md(tasks, ["task-001", "task-002"])
        assert "## task-001: Add cycle detection" in md
        assert "- **Slug**: add-cycle-detection" in md


class TestSkeletonPreflightCarriesSlug:
    def test_preflight_result_includes_slug(self, tmp_path):
        from datum.skeleton_creator import run_preflight

        tasks_path = tmp_path / "tasks.json"
        tasks_path.write_text(
            json.dumps(
                [
                    _task(
                        slug="add-cycle-detection",
                        files=["datum/x.py", "tests/test_x.py"],
                    )
                ]
            )
        )
        result = run_preflight(
            task_id="task-001",
            language="python",
            tasks_path=tasks_path,
            output_path=None,
            skip_file_writes=True,
        )
        assert result["task_id"] == "task-001"
        assert result["slug"] == "add-cycle-detection"
