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
    # Neutralize any machine-global git hooks (core.hooksPath) for this
    # fixture repo: a global post-checkout/post-commit hook that writes
    # into every new worktree (e.g. an indexing tool) leaves untracked
    # files behind, which makes git worktree remove's non-force safety
    # check correctly-but-spuriously refuse to clean up a stale worktree
    # in tests — unrelated to any real uncommitted work. Root cause of the
    # flaky failures tracked in issue #381.
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo_root)
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


class TestPathTraversalValidation:
    """Security: run_id/lane_id must not escape WORKTREE_ROOT via '..' segments."""

    def test_create_lane_worktree_rejects_traversal_run_id(self, repo, tmp_path):
        from datum.worktree_manager import create_lane_worktree

        with pytest.raises(ValueError):
            create_lane_worktree(
                "epic/test",
                "lane-a",
                "../../../../tmp/evil",
                "HEAD",
                repo_root=repo,
            )

    def test_create_lane_worktree_rejects_traversal_lane_id(self, repo, tmp_path):
        from datum.worktree_manager import create_lane_worktree

        with pytest.raises(ValueError):
            create_lane_worktree(
                "epic/test",
                "../../../../tmp/evil",
                "run1",
                "HEAD",
                repo_root=repo,
            )

    def test_cleanup_run_worktrees_rejects_traversal_run_id(self, repo):
        from datum.worktree_manager import cleanup_run_worktrees

        with pytest.raises(ValueError):
            cleanup_run_worktrees("../../../../tmp/evil", "epic/test", repo_root=repo)

    def test_worktree_path_for_lane_rejects_traversal(self, repo):
        from datum.worktree_manager import worktree_path_for_lane

        with pytest.raises(ValueError):
            worktree_path_for_lane("../../../../tmp/evil", "run1", repo_root=repo)


class TestCreateLaneWorktree:
    """Coverage gap: create_lane_worktree() had zero direct tests despite
    complex resume/branch-collision/stale-worktree-reclaim logic that
    creates real worktrees and branches."""

    def test_creates_worktree_and_branch(self, repo: Path):
        from datum.worktree_manager import create_lane_worktree

        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        wt_path = create_lane_worktree(
            "epic/test", "lane-a", "run-1", base_sha, repo_root=repo
        )
        assert wt_path.is_dir()
        branch = _git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=wt_path).stdout.strip()
        assert branch == "epic/test--lane-a"

    def test_resume_is_idempotent_for_an_already_registered_worktree(self, repo: Path):
        """Calling create_lane_worktree twice with the same args must not
        error — it should detect the already-registered worktree and reuse
        it (the 'Resume' branch in the source)."""
        from datum.worktree_manager import create_lane_worktree

        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        first = create_lane_worktree(
            "epic/test", "lane-a", "run-1", base_sha, repo_root=repo
        )
        second = create_lane_worktree(
            "epic/test", "lane-a", "run-1", base_sha, repo_root=repo
        )
        assert first == second
        assert second.is_dir()

    def test_reclaims_lane_branch_from_a_stale_orphaned_worktree(self, repo: Path):
        """Real scenario the source comments describe: an earlier incomplete
        run left lane_branch checked out in a now-orphaned worktree dir (its
        run finished/errored without cleanup). A new run for the SAME lane_id
        under a DIFFERENT run_id must reclaim the branch by deregistering the
        stale worktree, not fail outright — since lane_branch has no run_id
        in its name (only the worktree PATH does), this collision is real."""
        from datum.worktree_manager import create_lane_worktree

        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        stale_path = create_lane_worktree(
            "epic/test", "lane-a", "run-1", base_sha, repo_root=repo
        )
        assert stale_path.is_dir()

        # A second run, different run_id, same lane_id — same lane_branch name.
        new_path = create_lane_worktree(
            "epic/test", "lane-a", "run-2", base_sha, repo_root=repo
        )
        assert new_path != stale_path
        assert new_path.is_dir()
        branch = _git(
            ["rev-parse", "--abbrev-ref", "HEAD"], cwd=new_path
        ).stdout.strip()
        assert branch == "epic/test--lane-a"
        # The stale worktree's registration must have been cleaned up, not
        # left dangling.
        registered = _git(["worktree", "list", "--porcelain"], cwd=repo).stdout
        assert str(stale_path) not in registered


class TestMergeLaneBranches:
    """Coverage gap: merge_lane_branches() had zero tests despite being the
    function that rewrites the epic branch's real history via squash-merge."""

    def test_squash_merges_lanes_in_order_into_one_commit(self, repo: Path):
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")
        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        _add_lane_commit(repo, lane_b, "b.txt")

        _git(["checkout", "epic/test"], cwd=repo)
        before_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()

        sha = merge_lane_branches(
            "epic/test", ["lane-a", "lane-b"], "merge: lanes a+b", repo_root=repo
        )

        assert sha
        after_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()
        # Exactly one new commit landed on the epic branch (squashed).
        assert len(after_log) == len(before_log) + 1
        assert (repo / "a.txt").exists()
        assert (repo / "b.txt").exists()
        head_msg = _git(["log", "-1", "--format=%s"], cwd=repo).stdout.strip()
        assert head_msg == "merge: lanes a+b"

    def test_empty_lane_order_raises_instead_of_silently_no_op(self, repo: Path):
        """Zero completed lanes must fail clearly (nothing to commit), not
        silently succeed and return a misleading 'merge' SHA that is really
        just the epic branch's unchanged HEAD."""
        from datum.worktree_manager import merge_lane_branches

        with pytest.raises(RuntimeError):
            merge_lane_branches("epic/test", [], "merge: nothing", repo_root=repo)

    def test_conflicting_lane_merge_raises_naming_the_lane(self, repo: Path):
        """Two lane branches editing the same file in conflicting ways must
        raise RuntimeError naming the failing lane, not silently pick one
        side or corrupt the epic branch."""
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        wt_a = repo.parent / "wt-conflict-a"
        _git(["worktree", "add", str(wt_a), lane_a], cwd=repo)
        (wt_a / "shared.txt").write_text("from lane a\n")
        _git(["add", "shared.txt"], cwd=wt_a)
        _git(["commit", "-q", "-m", "lane a edits shared.txt"], cwd=wt_a)
        _git(["worktree", "remove", "--force", str(wt_a)], cwd=repo)

        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        wt_b = repo.parent / "wt-conflict-b"
        _git(["worktree", "add", str(wt_b), lane_b], cwd=repo)
        (wt_b / "shared.txt").write_text("from lane b\n")
        _git(["add", "shared.txt"], cwd=wt_b)
        _git(["commit", "-q", "-m", "lane b edits shared.txt"], cwd=wt_b)
        _git(["worktree", "remove", "--force", str(wt_b)], cwd=repo)

        _git(["checkout", "epic/test"], cwd=repo)
        with pytest.raises(RuntimeError, match="lane-b"):
            merge_lane_branches(
                "epic/test", ["lane-a", "lane-b"], "merge: conflict", repo_root=repo
            )
