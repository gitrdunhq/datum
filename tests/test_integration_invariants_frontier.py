"""RED tests for datum.integration_invariants: merge-frontier grouping and
synthetic INT lane construction.

derive_integration_lanes(invariants, tasks, test_command) -> list[dict]
groups invariants sharing a sorted `covers` tuple into one synthetic
integration lane per group, numbered `task-INT-<n>` in topological order.

unknown_covered_tasks(invariants, tasks) -> list[(invariant_id, task_id)]
returns the raw data for Covers entries that reference an absent task id.
"""

from __future__ import annotations

import random

import pytest

from datum.integration_invariants import (
    derive_integration_lanes,
    unknown_covered_tasks,
)

TASKS = {
    "task-001": {"depends_on": []},
    "task-002": {"depends_on": ["task-001"]},
    "task-003": {"depends_on": ["task-002"]},
    "task-004": {"depends_on": []},
}

# Deliberately NOT in topological order: task-003's group appears before
# task-001's group, even though task-001 is an ancestor of task-003.
INVARIANTS = [
    {
        "id": "INV-010",
        "invariant": "Task 3 output is well formed",
        "covers": ["task-003"],
        "source": "spec:section-9",
    },
    {
        "id": "INV-020",
        "invariant": "Task 1 output is unique",
        "covers": ["task-001"],
        "source": "spec:section-1",
    },
    {
        "id": "INV-030",
        "invariant": "Task 4 output is isolated",
        "covers": ["task-004"],
        "source": "spec:section-4",
    },
]

PYTEST_CMD = "uv run pytest -x -q"
VITEST_CMD = "npx vitest run"


class TestDeriveIntegrationLanesGroupsByCoversTuple:
    def test_merges_invariants_sharing_a_sorted_covers_tuple(self) -> None:
        invariants = INVARIANTS + [
            {
                "id": "INV-021",
                "invariant": "Task 1 output stays unique across reruns",
                "covers": ["task-001"],
                "source": "spec:section-2",
            }
        ]
        lanes = derive_integration_lanes(invariants, TASKS, PYTEST_CMD)
        assert len(lanes) == 3
        task1_lane = next(l for l in lanes if l["depends_on"] == ["task-001"])
        # The id leads each AC so the skeleton names the test after the
        # invariant (AC6.2; review CORR-002).
        assert task1_lane["acceptance_criteria"] == [
            "INV-020: Task 1 output is unique",
            "INV-021: Task 1 output stays unique across reruns",
        ]


class TestDeriveIntegrationLanesFieldsAndNumbering:
    def test_lane_ids_kind_expect_tests_pass_depends_on_and_ac_order(self) -> None:
        lanes = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        assert [lane["id"] for lane in lanes] == [
            "task-INT-1",
            "task-INT-2",
            "task-INT-3",
        ]
        for lane in lanes:
            assert lane["kind"] == "integration"
            assert lane["expect_tests_pass"] is True
        assert lanes[0]["depends_on"] == ["task-001"]
        assert lanes[1]["depends_on"] == ["task-003"]
        assert lanes[2]["depends_on"] == ["task-004"]
        assert lanes[0]["acceptance_criteria"] == ["INV-020: Task 1 output is unique"]


class TestDeriveIntegrationLanesFilesRunnerSelection:
    def test_pytest_command_produces_tests_integration_path(self) -> None:
        lanes = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        assert lanes[0]["files"] == ["tests/integration/test_int_1.py"]
        assert lanes[1]["files"] == ["tests/integration/test_int_2.py"]
        assert lanes[2]["files"] == ["tests/integration/test_int_3.py"]

    def test_typescript_command_produces_src_integration_ts_path(self) -> None:
        lanes = derive_integration_lanes(INVARIANTS, TASKS, VITEST_CMD)
        assert lanes[0]["files"] == ["src/integration/int-1.test.ts"]
        assert lanes[1]["files"] == ["src/integration/int-2.test.ts"]
        assert lanes[2]["files"] == ["src/integration/int-3.test.ts"]


class TestDeriveIntegrationLanesTopologicalNumbering:
    def test_ancestor_group_numbered_before_descendant_group_despite_input_order(
        self,
    ) -> None:
        # INV-010 (covers task-003, a descendant of task-001) appears FIRST
        # in the input list, but task-001's group must be numbered task-INT-1
        # because task-001 is an ancestor of task-003.
        lanes = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        lane_by_task = {tuple(lane["depends_on"]): lane["id"] for lane in lanes}
        assert lane_by_task[("task-001",)] == "task-INT-1"
        assert lane_by_task[("task-003",)] == "task-INT-2"
        assert lane_by_task[("task-004",)] == "task-INT-3"

    def test_ties_break_on_ascending_covered_task_id(self) -> None:
        # task-003 and task-004 have no ancestor relationship to each other,
        # so the tie must break on ascending covered-task-id: task-003 < task-004.
        lanes = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        ids_in_order = [lane["depends_on"][0] for lane in lanes]
        assert ids_in_order.index("task-003") < ids_in_order.index("task-004")


class TestDeriveIntegrationLanesDeterminism:
    def test_identical_result_on_repeated_calls(self) -> None:
        first = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        second = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        assert first == second

    def test_identical_result_regardless_of_input_insertion_order(self) -> None:
        shuffled_invariants = list(INVARIANTS)
        random.Random(42).shuffle(shuffled_invariants)
        shuffled_tasks = dict(reversed(list(TASKS.items())))

        baseline = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        shuffled = derive_integration_lanes(
            shuffled_invariants, shuffled_tasks, PYTEST_CMD
        )
        assert shuffled == baseline


class TestDeriveIntegrationLanesEmptyInput:
    def test_empty_invariant_list_returns_empty_list(self) -> None:
        assert derive_integration_lanes([], TASKS, PYTEST_CMD) == []


class TestDeriveIntegrationLanesRequiredScheduleFields:
    def test_lanes_carry_non_empty_title_and_red_note(self) -> None:
        lanes = derive_integration_lanes(INVARIANTS, TASKS, PYTEST_CMD)
        for lane in lanes:
            assert isinstance(lane["title"], str) and lane["title"] != ""
            assert isinstance(lane["red_note"], str) and lane["red_note"] != ""


class TestUnknownCoveredTasks:
    def test_returns_ordered_pairs_for_missing_covered_tasks(self) -> None:
        invariants = [
            {
                "id": "INV-100",
                "invariant": "Ghost task coverage",
                "covers": ["task-999", "task-001"],
                "source": "spec:section-7",
            },
            {
                "id": "INV-101",
                "invariant": "Another ghost",
                "covers": ["task-998"],
                "source": "spec:section-8",
            },
        ]
        pairs = unknown_covered_tasks(invariants, TASKS)
        assert pairs == [
            ("INV-100", "task-999"),
            ("INV-101", "task-998"),
        ]

    def test_returns_empty_list_when_all_covered_tasks_are_known(self) -> None:
        assert unknown_covered_tasks(INVARIANTS, TASKS) == []

    def test_does_not_raise_and_does_not_format_a_gate_message(self) -> None:
        invariants = [
            {
                "id": "INV-200",
                "invariant": "Unknown target",
                "covers": ["task-nope"],
                "source": "spec:section-6",
            }
        ]
        pairs = unknown_covered_tasks(invariants, TASKS)
        # Data only: no gate-message formatting like "invariant_covers_unknown_task:"
        assert pairs == [("INV-200", "task-nope")]
        assert all(":" not in pair[0] and ":" not in pair[1] for pair in pairs)


class TestIntegrationTestFileLanguage:
    """Review iteration 3, ARCH-001: the .py/.ts choice follows the same
    test_command language detection Plan uses for every other lane, and an
    unset or unrecognised command defaults to pytest paths, matching
    gate_plan's default, instead of silently producing .ts in a Python repo."""

    def test_pytest_and_ts_runners(self) -> None:
        py = derive_integration_lanes(INVARIANTS, TASKS, "uv run pytest -x -q")
        ts = derive_integration_lanes(INVARIANTS, TASKS, "npx vitest run")
        assert all(l["files"][0].endswith(".py") for l in py)
        assert all(l["files"][0].endswith(".test.ts") for l in ts)

    def test_unset_or_unrecognised_command_defaults_to_pytest_paths(self) -> None:
        for cmd in ("", "bash scripts/test.sh"):
            lanes = derive_integration_lanes(INVARIANTS, TASKS, cmd)
            assert all(l["files"][0].endswith(".py") for l in lanes), cmd
