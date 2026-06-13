"""Tests for datum CLI worktree and verify-stage commands (#133)."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from datum.cli import app

runner = CliRunner()


# ── Fixtures ──────────────────────────────────────────────────────────────────

EPIC_TAG = "epic-base-v0"


@pytest.fixture()
def git_repo(tmp_path, monkeypatch):
    """Minimal git repo with one commit, a tag for worktree base, and an
    epic branch for merge tests.

    Tag ``epic-base-v0`` is used as the base ref for setup/cleanup tests
    because worktree_manager creates lane branches as ``<ref>/<lane_id>``.
    A tag lives under ``refs/tags/`` so there is no ref-hierarchy conflict
    with ``refs/heads/<ref>/<lane_id>``.
    """
    monkeypatch.chdir(tmp_path)
    subprocess.run(
        ["git", "init", "-b", "main"], cwd=tmp_path, check=True, capture_output=True
    )
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
    )
    (tmp_path / "README.md").write_text("init")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "init"], cwd=tmp_path, check=True, capture_output=True
    )
    subprocess.run(
        ["git", "tag", EPIC_TAG], cwd=tmp_path, check=True, capture_output=True
    )
    return tmp_path


# ── worktrees setup ──────────────────────────────────────────────────────────


def test_worktrees_setup_creates_worktrees(git_repo):
    result = runner.invoke(
        app,
        [
            "worktrees",
            "setup",
            "--run-id",
            "run-001",
            "--epic-branch",
            EPIC_TAG,
            "--lane-ids",
            "task-001,task-002",
        ],
    )
    assert result.exit_code == 0, result.output
    mapping = json.loads(result.output)
    assert "task-001" in mapping
    assert "task-002" in mapping
    assert Path(mapping["task-001"]).exists()
    assert Path(mapping["task-002"]).exists()


def test_worktrees_setup_fails_without_epic_branch(git_repo):
    result = runner.invoke(
        app,
        [
            "worktrees",
            "setup",
            "--run-id",
            "run-002",
            "--epic-branch",
            "nonexistent-branch",
            "--lane-ids",
            "task-001",
        ],
    )
    assert result.exit_code != 0


def test_worktrees_setup_idempotent_error(git_repo):
    runner.invoke(
        app,
        [
            "worktrees",
            "setup",
            "--run-id",
            "run-003",
            "--epic-branch",
            EPIC_TAG,
            "--lane-ids",
            "task-001",
        ],
    )
    result = runner.invoke(
        app,
        [
            "worktrees",
            "setup",
            "--run-id",
            "run-003",
            "--epic-branch",
            EPIC_TAG,
            "--lane-ids",
            "task-001",
        ],
    )
    assert result.exit_code != 0


# ── worktrees merge ──────────────────────────────────────────────────────────


def test_worktrees_merge_squashes_in_order(git_repo):
    """Verify the merge CLI calls merge_lane_branches correctly and prints JSON."""
    fake_sha = "abc123def456"
    with patch(
        "datum.worktree_manager.merge_lane_branches", return_value=fake_sha
    ) as mock_merge:
        result = runner.invoke(
            app,
            [
                "worktrees",
                "merge",
                "--epic-branch",
                "some-branch",
                "--lane-order",
                "task-001,task-002",
                "--commit-message",
                "act: merge lanes",
            ],
        )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert data["sha"] == fake_sha
    assert data["merged"] == ["task-001", "task-002"]
    mock_merge.assert_called_once_with(
        "some-branch", ["task-001", "task-002"], "act: merge lanes"
    )


def test_worktrees_merge_fails_on_error():
    with patch(
        "datum.worktree_manager.merge_lane_branches",
        side_effect=RuntimeError("Squash-merge of lane 'x' failed"),
    ):
        result = runner.invoke(
            app,
            [
                "worktrees",
                "merge",
                "--epic-branch",
                "some-branch",
                "--lane-order",
                "task-nonexistent",
                "--commit-message",
                "should fail",
            ],
        )
    assert result.exit_code != 0


# ── worktrees cleanup ────────────────────────────────────────────────────────


def test_worktrees_cleanup_removes_all(git_repo):
    runner.invoke(
        app,
        [
            "worktrees",
            "setup",
            "--run-id",
            "run-005",
            "--epic-branch",
            EPIC_TAG,
            "--lane-ids",
            "task-001,task-002",
        ],
    )
    result = runner.invoke(
        app,
        [
            "worktrees",
            "cleanup",
            "--run-id",
            "run-005",
            "--epic-branch",
            EPIC_TAG,
        ],
    )
    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert set(data["cleaned"]) == {"task-001", "task-002"}
    assert not (git_repo / ".datum" / "worktrees" / "run-005" / "task-001").exists()


# ── verify-stage ──────────────────────────────────────────────────────────────


def test_verify_stage_red_passes_when_tests_fail():
    with patch("datum.tdd_driver.verify_red_stage") as mock_verify:
        result = runner.invoke(
            app,
            ["verify-stage", "red", "--repo", ".", "--test-command", "pytest -q"],
        )
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["verified"] is True
    mock_verify.assert_called_once()


def test_verify_stage_red_fails_when_tests_pass():
    from datum.tdd_driver import GreenBlindnessError

    with patch(
        "datum.tdd_driver.verify_red_stage",
        side_effect=GreenBlindnessError("tests passed"),
    ):
        result = runner.invoke(
            app,
            ["verify-stage", "red", "--repo", ".", "--test-command", "pytest -q"],
        )
    assert result.exit_code == 1
    data = json.loads(result.output)
    assert data["verified"] is False
    assert "tests passed" in data["error"]


def test_verify_stage_green_passes_when_tests_pass():
    with patch("datum.tdd_driver.verify_green_baseline") as mock_verify:
        result = runner.invoke(
            app,
            ["verify-stage", "green", "--repo", ".", "--test-command", "pytest -q"],
        )
    assert result.exit_code == 0
    data = json.loads(result.output)
    assert data["verified"] is True
    mock_verify.assert_called_once()


def test_verify_stage_green_fails_when_tests_fail():
    from datum.tdd_driver import DirtyBaselineError

    with patch(
        "datum.tdd_driver.verify_green_baseline",
        side_effect=DirtyBaselineError("tests failed"),
    ):
        result = runner.invoke(
            app,
            ["verify-stage", "green", "--repo", ".", "--test-command", "pytest -q"],
        )
    assert result.exit_code == 1
    data = json.loads(result.output)
    assert data["verified"] is False


def test_verify_stage_custom_test_command():
    with patch("datum.tdd_driver.verify_green_baseline") as mock_verify:
        result = runner.invoke(
            app,
            [
                "verify-stage",
                "green",
                "--repo",
                ".",
                "--test-command",
                "python -m pytest tests/specific.py",
            ],
        )
    assert result.exit_code == 0
    call_args = mock_verify.call_args
    assert call_args[1]["test_command"] == [
        "python",
        "-m",
        "pytest",
        "tests/specific.py",
    ]


def test_verify_stage_unknown_stage_exits_1():
    result = runner.invoke(
        app,
        ["verify-stage", "foobar", "--repo", "."],
    )
    assert result.exit_code == 1
    data = json.loads(result.output)
    assert data["verified"] is False
    assert "Unknown stage" in data["error"]
