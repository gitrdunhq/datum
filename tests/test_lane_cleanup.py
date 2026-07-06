"""Tests for datum.lane_cleanup.

Structured replacement for the free-text "find files matching a pattern,
then rm each one" agent prompt previously issued by the datum-tdd-act-lane
workflow's pre-RED cleanup step. That prompt read as an arbitrary shell
deletion to any permission classifier watching the sub-agent's tool calls;
this module makes the same operation a deterministic, testable Python
function with no LLM or shell pattern-matching in the loop.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from datum.lane_cleanup import clean_lane_worktree, stray_test_files


def _git(worktree: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(worktree), *args], check=True, capture_output=True)


@pytest.fixture
def worktree(tmp_path: Path) -> Path:
    wt = tmp_path / "wt"
    wt.mkdir()
    _git(wt, "init", "-q")
    _git(wt, "config", "user.email", "test@example.com")
    _git(wt, "config", "user.name", "Test")
    (wt / "tests").mkdir()
    (wt / "src").mkdir()
    return wt


def test_stray_untracked_test_file_is_flagged(worktree: Path) -> None:
    (worktree / "tests" / "foo.test.ts").write_text("stray")
    strays = stray_test_files(worktree, allowed_test_files=[])
    assert strays == ["tests/foo.test.ts"]


def test_allowed_test_file_is_not_flagged(worktree: Path) -> None:
    (worktree / "tests" / "foo.test.ts").write_text("wanted")
    strays = stray_test_files(worktree, allowed_test_files=["tests/foo.test.ts"])
    assert strays == []


def test_allowed_test_file_matches_without_tests_prefix(worktree: Path) -> None:
    """Lane plans sometimes list files without the tests/ prefix — must still match."""
    (worktree / "tests" / "foo.test.ts").write_text("wanted")
    strays = stray_test_files(worktree, allowed_test_files=["foo.test.ts"])
    assert strays == []


def test_non_test_file_is_never_flagged(worktree: Path) -> None:
    (worktree / "src" / "helper.ts").write_text("not a test")
    strays = stray_test_files(worktree, allowed_test_files=[])
    assert strays == []


def test_python_test_file_pattern_matches(worktree: Path) -> None:
    (worktree / "tests" / "test_stray.py").write_text("stray")
    strays = stray_test_files(worktree, allowed_test_files=[])
    assert strays == ["tests/test_stray.py"]


def test_tracked_test_file_is_never_flagged(worktree: Path) -> None:
    """git ls-files --others only returns untracked files — committed files are safe."""
    tracked = worktree / "tests" / "committed.test.ts"
    tracked.write_text("committed")
    _git(worktree, "add", "tests/committed.test.ts")
    _git(worktree, "commit", "-q", "-m", "add tracked test")
    strays = stray_test_files(worktree, allowed_test_files=[])
    assert strays == []


def test_clean_lane_worktree_removes_only_strays_and_returns_removed_paths(
    worktree: Path,
) -> None:
    stray = worktree / "tests" / "stray.test.ts"
    stray.write_text("stray")
    wanted = worktree / "tests" / "wanted.test.ts"
    wanted.write_text("wanted")

    removed = clean_lane_worktree(worktree, allowed_test_files=["tests/wanted.test.ts"])

    assert removed == ["tests/stray.test.ts"]
    assert not stray.exists()
    assert wanted.exists()


def test_clean_lane_worktree_no_strays_returns_empty_list(worktree: Path) -> None:
    assert clean_lane_worktree(worktree, allowed_test_files=[]) == []
