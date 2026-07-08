"""Tests for datum/worktree_manager.py lane branch cleanup safety.

Issue #309: remove_lane_worktree() / cleanup_run_worktrees() must not
force-delete a lane sub-branch (<epic_branch>--<lane_id>) that has real
RED/GREEN commits beyond the point it was forked from the epic branch.
Only branches with zero new commits (pointer-only, never advanced past
the fork point) are safe to force-delete.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from datum.worktree_manager import (
    cleanup_run_worktrees,
    housekeep_epic,
    remove_lane_worktree,
)


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, check=True
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A minimal git repo with an epic branch that has one commit."""
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    _git(["init", "-q"], cwd=repo_root)
    _git(["config", "user.email", "test@example.com"], cwd=repo_root)
    _git(["config", "user.name", "Test"], cwd=repo_root)
    (repo_root / "README.md").write_text("hello\n")
    _git(["add", "README.md"], cwd=repo_root)
    _git(["commit", "-q", "-m", "initial commit"], cwd=repo_root)
    _git(["branch", "-M", "epic/test"], cwd=repo_root)
    return repo_root


def _make_lane_branch(repo_root: Path, epic_branch: str, lane_id: str) -> str:
    """Create a lane sub-branch forked from the epic branch tip, no new commits."""
    lane_branch = f"{epic_branch}--{lane_id}"
    _git(["branch", lane_branch, epic_branch], cwd=repo_root)
    return lane_branch


def _add_lane_commit(repo_root: Path, lane_branch: str, filename: str) -> None:
    """Add a real commit on the lane branch (simulating RED/GREEN work)."""
    worktree_dir = repo_root.parent / f"wt-{filename}"
    _git(["worktree", "add", str(worktree_dir), lane_branch], cwd=repo_root)
    (worktree_dir / filename).write_text("work in progress\n")
    _git(["add", filename], cwd=worktree_dir)
    _git(["commit", "-q", "-m", f"real work: {filename}"], cwd=worktree_dir)
    _git(["worktree", "remove", "--force", str(worktree_dir)], cwd=repo_root)


class TestRemoveLaneWorktreeBranchSafety:
    def test_empty_lane_branch_is_force_deleted(self, repo: Path):
        """A lane branch with zero commits beyond the fork point is deleted."""
        epic_branch = "epic/test"
        lane_id = "task-empty"
        run_id = "run-1"
        lane_branch = _make_lane_branch(repo, epic_branch, lane_id)

        # No worktree dir was ever created for this lane in this test —
        # remove_lane_worktree must still handle a missing worktree path
        # gracefully (fails open) and act only on the branch.
        result = remove_lane_worktree(lane_id, run_id, epic_branch, repo_root=repo)

        assert result["deleted"] is True
        assert result["preserved"] is False
        assert result["branch"] == lane_branch

        verify = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", lane_branch],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        assert verify.returncode != 0, "empty lane branch should have been deleted"

    def test_lane_branch_with_real_commits_is_preserved(self, repo: Path):
        """A lane branch with real RED/GREEN commits is NOT deleted."""
        epic_branch = "epic/test"
        lane_id = "task-007"
        run_id = "run-1"
        lane_branch = _make_lane_branch(repo, epic_branch, lane_id)
        _add_lane_commit(repo, lane_branch, "task007_work.py")

        result = remove_lane_worktree(lane_id, run_id, epic_branch, repo_root=repo)

        assert result["deleted"] is False
        assert result["preserved"] is True
        assert result["branch"] == lane_branch

        verify = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", lane_branch],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        assert (
            verify.returncode == 0
        ), "lane branch with real commits must be preserved, not deleted"


class TestCleanupRunWorktreesReportsPreservedBranches:
    def test_mixed_run_reports_removed_and_preserved(self, repo: Path):
        """cleanup_run_worktrees() separates safe-deletes from preserved branches."""
        epic_branch = "epic/test"
        run_id = "run-mixed"

        empty_lane = "task-empty"
        busy_lane = "task-007"

        empty_branch = _make_lane_branch(repo, epic_branch, empty_lane)
        busy_branch = _make_lane_branch(repo, epic_branch, busy_lane)
        _add_lane_commit(repo, busy_branch, "task007_work.py")

        # Register lane worktree directories so cleanup_run_worktrees()
        # discovers both lanes under .datum/worktrees/<run_id>/.
        run_dir = repo / ".datum" / "worktrees" / run_id
        for lane_id, branch in ((empty_lane, empty_branch), (busy_lane, busy_branch)):
            lane_path = run_dir / lane_id
            _git(["worktree", "add", str(lane_path), branch], cwd=repo)

        result = cleanup_run_worktrees(run_id, epic_branch, repo_root=repo)

        assert result["removed"] == [empty_lane]
        assert result["preserved_with_commits"] == [busy_lane]

        # The empty lane's branch is gone; the busy lane's branch survives.
        empty_check = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", empty_branch],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        busy_check = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", busy_branch],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        assert empty_check.returncode != 0
        assert busy_check.returncode == 0


class TestHousekeepEpic:
    def test_batches_branch_deletion_for_multiple_merged_lanes(self, repo: Path):
        epic_branch = "epic/test"
        lane_a = _make_lane_branch(repo, epic_branch, "task-a")
        lane_b = _make_lane_branch(repo, epic_branch, "task-b")
        _git(["checkout", epic_branch], cwd=repo)

        result = housekeep_epic(epic_branch, repo_root=repo)

        assert sorted(result["deleted_branches"]) == sorted([lane_a, lane_b])
        for branch in (lane_a, lane_b):
            check = subprocess.run(
                ["git", "rev-parse", "--verify", "--quiet", branch],
                cwd=repo,
                capture_output=True,
                text=True,
            )
            assert check.returncode != 0

    def test_removes_pipeline_state_marker(self, repo: Path):
        state_dir = repo / ".datum"
        state_dir.mkdir(exist_ok=True)
        state_path = state_dir / "pipeline-state.json"
        state_path.write_text("{}")

        result = housekeep_epic("epic/test", repo_root=repo)

        assert result["pipeline_state_removed"] is True
        assert not state_path.exists()

    def test_leaves_unmerged_lane_branch_alone_while_deleting_merged_one(
        self, repo: Path
    ):
        epic_branch = "epic/test"
        merged_lane = _make_lane_branch(repo, epic_branch, "task-merged")
        unmerged_lane = _make_lane_branch(repo, epic_branch, "task-unmerged")
        _add_lane_commit(repo, unmerged_lane, "unmerged_work.py")
        _git(["checkout", epic_branch], cwd=repo)

        result = housekeep_epic(epic_branch, repo_root=repo)

        assert result["deleted_branches"] == [merged_lane]
        merged_check = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", merged_lane],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        unmerged_check = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", unmerged_lane],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        assert merged_check.returncode != 0
        assert unmerged_check.returncode == 0
