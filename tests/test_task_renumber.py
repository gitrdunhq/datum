"""Tests for datum.task_renumber.renumber_tasks — deterministic post-decompose
renumbering of task-NNN ids to PREFIX-n (task-010).

Acceptance criteria covered:
AC1: renumber_tasks(tasks, prefix, start) assigns ids in order and rewrites
     depends_on references alongside the ids they target.
AC2: assignment follows dependency order — a task that is depended upon
     receives a lower number than the task depending on it.
AC3: after renumbering, no value anywhere in the returned structure matches
     ^task-\\d+$ — every depends_on reference is rewritten alongside its id.
AC4: a task whose id is already prefixed (e.g. 'DAT-142') is left untouched
     and its number is not reissued to another task.
"""

from __future__ import annotations

import json
import re

from datum.task_renumber import renumber_tasks


def test_ac1_renumber_tasks_assigns_sequential_prefixed_ids_and_rewrites_depends_on():
    tasks = [
        {"id": "task-001", "depends_on": []},
        {"id": "task-002", "depends_on": ["task-001"]},
    ]

    result = renumber_tasks(tasks, "DAT", 142)

    by_old_index = {t["id"]: t for t in result}
    ids = [t["id"] for t in result]
    assert "DAT-142" in ids
    assert "DAT-143" in ids

    task_002_new = next(t for t in result if t.get("depends_on") == ["DAT-142"])
    assert task_002_new["id"] == "DAT-143"


def test_ac2_dependency_receives_lower_number_than_its_dependent():
    # task-001 depends_on task-002: task-002 must receive the lower number.
    tasks = [
        {"id": "task-001", "depends_on": ["task-002"]},
        {"id": "task-002", "depends_on": []},
    ]

    result = renumber_tasks(tasks, "DAT", 1)

    new_id_of_001 = next(t["id"] for t in result if t.get("depends_on") == ["DAT-1"])
    new_id_of_002 = next(t["id"] for t in result if t.get("depends_on") == [])

    number_001 = int(new_id_of_001.rsplit("-", 1)[1])
    number_002 = int(new_id_of_002.rsplit("-", 1)[1])
    assert number_002 < number_001
    assert new_id_of_001.split("-")[0] == "DAT"


def test_ac3_no_leftover_task_nnn_references_anywhere_in_result():
    tasks = [
        {"id": "task-001", "depends_on": []},
        {"id": "task-002", "depends_on": ["task-001"]},
        {"id": "task-003", "depends_on": ["task-001", "task-002"]},
    ]

    result = renumber_tasks(tasks, "DAT", 5)

    serialized = json.dumps(result)
    assert re.search(r"task-\d+", serialized) is None
    assert len(result) == 3


def test_ac4_already_prefixed_task_is_untouched_and_its_number_not_reissued():
    tasks = [
        {"id": "DAT-142", "depends_on": []},
        {"id": "task-001", "depends_on": ["DAT-142"]},
    ]

    result = renumber_tasks(tasks, "DAT", 142)

    already_prefixed = next(t for t in result if t["id"] == "DAT-142")
    assert already_prefixed["depends_on"] == []

    renumbered = next(t for t in result if t["id"] != "DAT-142")
    assert renumbered["id"] == "DAT-143"
    assert renumbered["depends_on"] == ["DAT-142"]
