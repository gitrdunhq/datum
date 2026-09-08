"""Wiring tests for `datum lane-plan --renumber` (task-010).

Acceptance criteria covered:
AC5: `datum lane-plan --renumber --input tasks.json --output ...` rewrites
     tasks.json ON DISK so the file itself holds <PREFIX>-<n> ids, before
     schema validation and lane-plan construction run; without --renumber,
     ids stay untouched.
AC6: `datum lane-plan --validate --input tasks.json` leaves that file
     byte-identical even when --renumber is also passed — the renumber step
     never runs on the validate path (Req 7 AC2).
AC7: with --renumber, the prefix comes from
     datum.task_ids.resolve_task_id_prefix(repo_root) and the start from
     datum.task_ids.next_task_number(repo_root, prefix); when the repo has
     no git HEAD or no committed prefixed id, the start is 1 and no error
     is raised.
"""

from __future__ import annotations

import json
import sys

from datum.lane_plan import main


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


def test_ac5_renumber_flag_rewrites_tasks_json_on_disk_with_prefixed_ids(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    input_path = tmp_path / "tasks.json"
    input_path.write_text(json.dumps(_tasks()))
    output_path = tmp_path / "lane-plan.json"
    md_output_path = tmp_path / "TASKS.md"

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "lane_plan.py",
            "--renumber",
            "--input",
            str(input_path),
            "--output",
            str(output_path),
            "--md-output",
            str(md_output_path),
        ],
    )

    main()

    on_disk = json.loads(input_path.read_text())
    ids = [t["id"] for t in on_disk]
    assert not any(i.startswith("task-") for i in ids)
    assert all("-" in i and i.split("-")[-1].isdigit() for i in ids)


def test_ac5_without_renumber_flag_ids_on_disk_remain_task_nnn(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    input_path = tmp_path / "tasks.json"
    original = json.dumps(_tasks())
    input_path.write_text(original)
    output_path = tmp_path / "lane-plan.json"
    md_output_path = tmp_path / "TASKS.md"

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
        ],
    )

    main()

    assert input_path.read_text() == original
    on_disk = json.loads(input_path.read_text())
    assert [t["id"] for t in on_disk] == ["task-001", "task-002"]


def test_ac6_validate_leaves_tasks_json_byte_identical_even_with_renumber(
    tmp_path, monkeypatch
):
    monkeypatch.chdir(tmp_path)
    input_path = tmp_path / "tasks.json"
    original_bytes = json.dumps(_tasks()).encode("utf-8")
    input_path.write_bytes(original_bytes)

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "lane_plan.py",
            "--validate",
            "--renumber",
            "--input",
            str(input_path),
        ],
    )

    main()

    assert input_path.read_bytes() == original_bytes


def test_ac7_renumber_with_no_git_head_starts_at_one_and_raises_no_error(
    tmp_path, monkeypatch
):
    # A bare tmp_path repo has no .git and no committed history at all, so
    # datum.task_ids.next_task_number must not blow up: start must be 1.
    monkeypatch.chdir(tmp_path)
    input_path = tmp_path / "tasks.json"
    input_path.write_text(json.dumps(_tasks()))
    output_path = tmp_path / "lane-plan.json"
    md_output_path = tmp_path / "TASKS.md"

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "lane_plan.py",
            "--renumber",
            "--input",
            str(input_path),
            "--output",
            str(output_path),
            "--md-output",
            str(md_output_path),
        ],
    )

    main()

    on_disk = json.loads(input_path.read_text())
    ids = sorted(t["id"] for t in on_disk)
    numbers = sorted(int(i.rsplit("-", 1)[1]) for i in ids)
    assert numbers == [1, 2]
