"""Tests for units-of-work support in lane_plan.py."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from datum.lane_plan import (  # noqa: E402
    normalize_input,
    validate_units,
)

# ── helpers ──────────────────────────────────────────────────────────────

TASK_A = {
    "id": "task-001",
    "title": "Create widget",
    "acceptance_criteria": ["widget exists"],
    "files": ["widget.py"],
    "red_note": "test widget creation",
    "depends_on": [],
}

TASK_B = {
    "id": "task-002",
    "title": "Create gadget",
    "acceptance_criteria": ["gadget exists"],
    "files": ["gadget.py"],
    "red_note": "test gadget creation",
    "depends_on": ["task-001"],
}

TASK_C = {
    "id": "task-003",
    "title": "Integration",
    "acceptance_criteria": ["integration works"],
    "files": ["integration.py"],
    "red_note": "test integration",
    "depends_on": ["task-002"],
}


def _run_lane_plan(
    input_data: list | dict,
    extra_args: list[str] | None = None,
) -> subprocess.CompletedProcess:
    """Write input_data to a temp file and invoke lane_plan.py via subprocess."""
    with tempfile.TemporaryDirectory() as tmp:
        inp = Path(tmp) / "tasks.json"
        out = Path(tmp) / "lane-plan.json"
        md = Path(tmp) / "TASKS.md"
        inp.write_text(json.dumps(input_data))

        cmd = [
            sys.executable,
            str(ROOT / "datum" / "lane_plan.py"),
            "--input",
            str(inp),
            "--output",
            str(out),
            "--md-output",
            str(md),
        ]
        if extra_args:
            cmd.extend(extra_args)

        result = subprocess.run(cmd, capture_output=True, text=True)
        # Attach file contents for assertion convenience
        result.lane_plan_json = json.loads(out.read_text()) if out.exists() else None
        result.tasks_md = md.read_text() if md.exists() else None
        return result


# ── tests ────────────────────────────────────────────────────────────────


class TestNormalizeInput(unittest.TestCase):
    """normalize_input dispatches plain lists vs object-with-units."""

    def test_plain_list_returns_list_and_empty_units(self):
        tasks, units = normalize_input([TASK_A, TASK_B])
        self.assertEqual(tasks, [TASK_A, TASK_B])
        self.assertEqual(units, {})

    def test_object_returns_tasks_and_units(self):
        units_def = {
            "unit-a": {
                "name": "Unit A",
                "tasks": ["task-001"],
                "depends_on": [],
            }
        }
        raw = {"tasks": [TASK_A], "units": units_def}
        tasks, units = normalize_input(raw)
        self.assertEqual(tasks, [TASK_A])
        self.assertEqual(units, units_def)

    def test_object_without_units_key_defaults_empty(self):
        raw = {"tasks": [TASK_A]}
        tasks, units = normalize_input(raw)
        self.assertEqual(tasks, [TASK_A])
        self.assertEqual(units, {})


class TestValidateUnits(unittest.TestCase):
    """validate_units catches bad references and passes good ones."""

    def test_valid_units_no_errors(self):
        units = {
            "unit-a": {
                "name": "Unit A",
                "tasks": ["task-001"],
                "depends_on": [],
            }
        }
        errors = validate_units(units, {"task-001", "task-002"})
        self.assertEqual(errors, [])

    def test_task_references_nonexistent_unit_task(self):
        units = {
            "unit-z": {
                "name": "Ghost unit",
                "tasks": ["task-999"],
                "depends_on": [],
            }
        }
        errors = validate_units(units, {"task-001"})
        self.assertTrue(len(errors) > 0)
        self.assertIn("task-999", errors[0])

    def test_unit_depends_on_nonexistent_unit(self):
        units = {
            "unit-a": {
                "name": "A",
                "tasks": ["task-001"],
                "depends_on": ["unit-nope"],
            }
        }
        errors = validate_units(units, {"task-001"})
        self.assertTrue(len(errors) > 0)
        self.assertIn("unit-nope", errors[0])


class TestUnitsOfWork(unittest.TestCase):
    """End-to-end tests via subprocess."""

    def test_plain_list_backward_compat(self):
        """INV-001/COMPAT-001: plain list produces identical output."""
        result = _run_lane_plan([TASK_A, TASK_B])
        self.assertEqual(result.returncode, 0, result.stderr)

        lp = result.lane_plan_json
        self.assertIsNotNone(lp)
        # Must NOT have a units key (or empty) for plain list input
        self.assertEqual(lp.get("units", {}), {})
        # Existing keys must still be present
        self.assertIn("schema_version", lp)
        self.assertIn("lanes", lp)
        self.assertIn("topological_order", lp)
        self.assertEqual(lp["total_lanes"], 2)

    def test_object_input_with_units(self):
        """Units are processed correctly."""
        units_def = {
            "unit-a": {
                "name": "Widget Unit",
                "tasks": ["task-001"],
                "depends_on": [],
            },
            "unit-b": {
                "name": "Gadget Unit",
                "tasks": ["task-002"],
                "depends_on": ["unit-a"],
            },
        }
        input_data = {
            "tasks": [TASK_A, TASK_B],
            "units": units_def,
        }
        result = _run_lane_plan(input_data)
        self.assertEqual(result.returncode, 0, result.stderr)

        lp = result.lane_plan_json
        self.assertIsNotNone(lp)
        self.assertIn("units", lp)
        self.assertEqual(lp["units"]["unit-a"]["name"], "Widget Unit")
        self.assertEqual(lp["units"]["unit-b"]["depends_on"], ["unit-a"])

    def test_cyclic_unit_deps_fail(self):
        """SAFE-003: no cyclic unit deps."""
        units_def = {
            "unit-a": {
                "name": "A",
                "tasks": ["task-001"],
                "depends_on": ["unit-b"],
            },
            "unit-b": {
                "name": "B",
                "tasks": ["task-002"],
                "depends_on": ["unit-a"],
            },
        }
        input_data = {
            "tasks": [TASK_A, TASK_B],
            "units": units_def,
        }
        result = _run_lane_plan(input_data)
        self.assertNotEqual(result.returncode, 0)

    def test_invalid_unit_reference_fails(self):
        """Unit references task-id that doesn't exist in the tasks list."""
        units_def = {
            "unit-z": {
                "name": "Ghost",
                "tasks": ["task-999"],
                "depends_on": [],
            },
        }
        input_data = {
            "tasks": [TASK_A],
            "units": units_def,
        }
        result = _run_lane_plan(input_data)
        self.assertNotEqual(result.returncode, 0)

    def test_tasks_grouped_by_unit_in_markdown(self):
        """TASKS.md groups tasks by unit."""
        units_def = {
            "unit-a": {
                "name": "Widget Unit",
                "tasks": ["task-001"],
                "depends_on": [],
            },
            "unit-b": {
                "name": "Gadget Unit",
                "tasks": ["task-002", "task-003"],
                "depends_on": ["unit-a"],
            },
        }
        input_data = {
            "tasks": [TASK_A, TASK_B, TASK_C],
            "units": units_def,
        }
        result = _run_lane_plan(input_data)
        self.assertEqual(result.returncode, 0, result.stderr)
        md = result.tasks_md
        self.assertIsNotNone(md)
        # Unit section headers must appear
        self.assertIn("Widget Unit", md)
        self.assertIn("Gadget Unit", md)
        # Dependency annotation between units
        self.assertIn("unit-a", md)

    def test_lane_plan_includes_units_metadata(self):
        """lane-plan.json includes units when present."""
        units_def = {
            "unit-a": {
                "name": "Widget Unit",
                "tasks": ["task-001"],
                "depends_on": [],
            },
        }
        input_data = {
            "tasks": [TASK_A],
            "units": units_def,
        }
        result = _run_lane_plan(input_data)
        self.assertEqual(result.returncode, 0, result.stderr)
        lp = result.lane_plan_json
        self.assertIn("units", lp)
        self.assertIn("unit-a", lp["units"])
        self.assertEqual(lp["units"]["unit-a"]["tasks"], ["task-001"])


if __name__ == "__main__":
    unittest.main()
