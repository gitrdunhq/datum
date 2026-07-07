"""Tests for `datum lane-state read|write` CLI subcommand.

Acceptance criteria under test:
1. `lane-state write` creates .datum/epics/<slug>/lane-state/<task>.json with the
   expected fields (task_id, status, merge_commit, spec_hash, run_id, completed_at).
2. `lane-state read` for an existing marker prints the exact JSON that was written.
3. `lane-state read` for a nonexistent marker exits 0 and prints {"status": "not_found"}.
4. Writing the same marker twice with identical inputs produces byte-identical files.
5. `lane-state write --epic '../../etc' ...` exits non-zero, creates no directory
   outside .datum/epics/.
6. Epic branch slugification: 'datum/epic-287' -> 'datum-epic-287'.
"""

import json
import os

from typer.testing import CliRunner

from datum.cli import app


def _epic_dir(datum_root, slug):
    return datum_root / "epics" / slug


def test_lane_state_write_creates_marker_with_expected_fields(tmp_path, monkeypatch):
    """AC1: `lane-state write` creates the marker file with the correct fields."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-287",
            "--task",
            "task-002",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "h1",
            "--run-id",
            "run1",
        ],
    )

    assert result.exit_code == 0, result.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-287"
        / "lane-state"
        / "task-002.json"
    )
    assert marker_path.exists(), "expected lane-state marker file to be created"

    data = json.loads(marker_path.read_text())
    assert data["task_id"] == "task-002"
    assert data["status"] == "completed"
    assert data["merge_commit"] == "abc123"
    assert data["spec_hash"] == "h1"
    assert data["run_id"] == "run1"
    assert "completed_at" in data


def test_lane_state_read_prints_matching_json_for_existing_marker(
    tmp_path, monkeypatch
):
    """AC2: `lane-state read` prints the exact JSON that was written by `write`."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-287",
            "--task",
            "task-002",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "h1",
            "--run-id",
            "run1",
        ],
    )
    assert write_result.exit_code == 0, write_result.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-287"
        / "lane-state"
        / "task-002.json"
    )
    expected = json.loads(marker_path.read_text())

    read_result = runner.invoke(
        app,
        ["lane-state", "read", "--epic", "datum/epic-287", "--task", "task-002"],
    )

    assert read_result.exit_code == 0, read_result.output
    printed = json.loads(read_result.stdout)
    assert printed == expected


def test_lane_state_read_returns_not_found_for_missing_marker(tmp_path, monkeypatch):
    """AC3: `lane-state read` for a missing marker exits 0 and prints not_found."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        ["lane-state", "read", "--epic", "datum/epic-287", "--task", "task-999"],
    )

    assert result.exit_code == 0, result.output
    printed = json.loads(result.stdout)
    assert printed == {"status": "not_found"}


def test_lane_state_write_twice_is_byte_identical(tmp_path, monkeypatch):
    """AC4: writing the same marker twice with identical inputs is byte-identical."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    args = [
        "lane-state",
        "write",
        "--epic",
        "datum/epic-287",
        "--task",
        "task-002",
        "--status",
        "completed",
        "--merge-commit",
        "abc123",
        "--spec-hash",
        "h1",
        "--run-id",
        "run1",
        "--completed-at",
        "2026-01-01T00:00:00Z",
    ]

    runner = CliRunner()
    first = runner.invoke(app, args)
    assert first.exit_code == 0, first.output

    marker_path = (
        tmp_path
        / ".datum"
        / "epics"
        / "datum-epic-287"
        / "lane-state"
        / "task-002.json"
    )
    first_bytes = marker_path.read_bytes()

    second = runner.invoke(app, args)
    assert second.exit_code == 0, second.output
    second_bytes = marker_path.read_bytes()

    assert first_bytes == second_bytes


def test_lane_state_write_rejects_path_traversal_epic(tmp_path, monkeypatch):
    """AC5: `--epic '../../etc'` exits non-zero and creates no directory outside epics/."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "../../etc",
            "--task",
            "x",
            "--status",
            "completed",
        ],
    )

    assert result.exit_code != 0

    # Must be a deliberate rejection of the traversal attempt, not merely the
    # "lane-state" command being unrecognized (Typer's "No such command" error
    # would also exit non-zero, which would make this test pass vacuously).
    assert "no such command" not in result.output.lower()

    # No directory named "etc" should be created anywhere outside .datum/epics/.
    outside_dir = tmp_path.parent.parent / "etc"
    assert not outside_dir.exists()

    epics_dir = tmp_path / ".datum" / "epics"
    if epics_dir.exists():
        for child in epics_dir.iterdir():
            assert ".." not in child.name


def test_lane_state_epic_branch_slugification(tmp_path, monkeypatch):
    """AC6: 'datum/epic-287' slugifies to 'datum-epic-287' as a directory name."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    runner = CliRunner()
    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-287",
            "--task",
            "task-slug-check",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "h1",
            "--run-id",
            "run1",
        ],
    )
    assert result.exit_code == 0, result.output

    slug_dir = tmp_path / ".datum" / "epics" / "datum-epic-287"
    assert slug_dir.is_dir()
    assert not (tmp_path / ".datum" / "epics" / "datum" / "epic-287").exists()
    assert os.path.sep not in "datum-epic-287"
