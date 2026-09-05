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


class TestCleanupRunWorktreesDiscoversPreservedBranchesWithoutDirs:
    """BUG D: cleanup_run_worktrees() derived its entire report from
    sorted(run_dir.iterdir()) — a lane whose worktree DIRECTORY is already
    gone (removed by a prior partial cleanup, an agent tidying up after
    itself, or a crash right after `git worktree remove`) was invisible to
    that scan. Its branch survived untouched (correctly preserved) but the
    report named it in neither list, so `preserved_with_commits` under-
    reported real preserved branches."""

    def test_lane_with_commits_and_no_worktree_dir_is_still_reported_preserved(
        self, repo: Path
    ):
        epic_branch = "epic/test"
        run_id = "run-mixed"

        present_lane = "task-present"
        vanished_lane = "task-vanished"

        present_branch = _make_lane_branch(repo, epic_branch, present_lane)
        _add_lane_commit(repo, present_branch, "present_work.py")
        vanished_branch = _make_lane_branch(repo, epic_branch, vanished_lane)
        _add_lane_commit(repo, vanished_branch, "vanished_work.py")

        run_dir = repo / ".datum" / "worktrees" / run_id
        for lane_id, branch in (
            (present_lane, present_branch),
            (vanished_lane, vanished_branch),
        ):
            lane_path = run_dir / lane_id
            _git(["worktree", "add", str(lane_path), branch], cwd=repo)

        # Simulate the vanished lane's worktree directory already having
        # been removed (its branch is untouched — real commits survive).
        vanished_path = run_dir / vanished_lane
        _git(["worktree", "remove", "--force", str(vanished_path)], cwd=repo)
        assert not vanished_path.exists()

        result = cleanup_run_worktrees(run_id, epic_branch, repo_root=repo)

        assert sorted(result["preserved_with_commits"]) == sorted(
            [present_lane, vanished_lane]
        )

        for branch in (present_branch, vanished_branch):
            check = subprocess.run(
                ["git", "rev-parse", "--verify", "--quiet", branch],
                cwd=repo,
                capture_output=True,
                text=True,
            )
            assert check.returncode == 0, f"{branch} must survive"


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

        result = merge_lane_branches(
            "epic/test", ["lane-a", "lane-b"], "merge: lanes a+b", repo_root=repo
        )

        assert result["sha"]
        assert result["merged"] == ["lane-a", "lane-b"]
        assert result["already_merged"] == []
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

    def test_conflicting_lane_merge_reports_which_lanes_already_merged(
        self, repo: Path
    ):
        """When a later lane fails, the error must say which earlier lanes
        were already squash-merged (staged) so the operator knows the repo
        state, not just which lane failed."""
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")

        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        wt_b = repo.parent / "wt-conflict-b2"
        _git(["worktree", "add", str(wt_b), lane_b], cwd=repo)
        (wt_b / "a.txt").write_text("conflicting content\n")
        _git(["add", "a.txt"], cwd=wt_b)
        _git(["commit", "-q", "-m", "lane b conflicts with lane a's a.txt"], cwd=wt_b)
        _git(["worktree", "remove", "--force", str(wt_b)], cwd=repo)

        _git(["checkout", "epic/test"], cwd=repo)
        with pytest.raises(RuntimeError, match="lane-b") as excinfo:
            merge_lane_branches(
                "epic/test", ["lane-a", "lane-b"], "merge: conflict", repo_root=repo
            )
        assert "lane-a" in str(excinfo.value)

    def test_two_lanes_editing_the_same_file_both_merge_into_one_commit(
        self, repo: Path
    ):
        """elonchesd run wf_4f1e41dd-ab7, merge batch 3/5: lane 1 was
        squash-merged with --no-commit and left STAGED, so lane 2's
        `git merge --squash` refused ("Your local changes to the following
        files would be overwritten by merge") because both lanes touched
        src/engine/state.ts — even though the edits did not conflict. Each
        lane's squash must land as its own temporary commit and the batch
        must be folded into ONE commit at the end."""
        from datum.worktree_manager import merge_lane_branches

        lines = [f"line {i}\n" for i in range(1, 13)]
        (repo / "shared.txt").write_text("".join(lines))
        _git(["add", "shared.txt"], cwd=repo)
        _git(["commit", "-q", "-m", "base: shared.txt"], cwd=repo)

        def edit_line(lane_id: str, index: int, text: str) -> None:
            lane_branch = _make_lane_branch(repo, "epic/test", lane_id)
            wt = repo.parent / f"wt-same-file-{lane_id}"
            _git(["worktree", "add", str(wt), lane_branch], cwd=repo)
            edited = list(lines)
            edited[index] = text
            (wt / "shared.txt").write_text("".join(edited))
            _git(["add", "shared.txt"], cwd=wt)
            _git(["commit", "-q", "-m", f"{lane_id} edits shared.txt"], cwd=wt)
            _git(["worktree", "remove", "--force", str(wt)], cwd=repo)

        edit_line("lane-a", 0, "line 1 (lane a)\n")
        edit_line("lane-b", 11, "line 12 (lane b)\n")

        _git(["checkout", "epic/test"], cwd=repo)
        before_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()

        result = merge_lane_branches(
            "epic/test", ["lane-a", "lane-b"], "merge: same file", repo_root=repo
        )

        assert result["merged"] == ["lane-a", "lane-b"]
        assert result["already_merged"] == []
        after_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()
        assert len(after_log) == len(before_log) + 1
        assert (
            _git(["log", "-1", "--format=%s"], cwd=repo).stdout.strip()
            == "merge: same file"
        )
        content = (repo / "shared.txt").read_text()
        assert "line 1 (lane a)\n" in content
        assert "line 12 (lane b)\n" in content
        assert _git(["status", "--porcelain"], cwd=repo).stdout == ""

    def test_conflicting_later_lane_keeps_earlier_lanes_committed_and_names_it(
        self, repo: Path
    ):
        """A real conflict in a later lane must not throw away the lanes that
        already merged cleanly: they are folded into one commit, the checkout
        is left clean, and the error carries the failed lane and the merged
        lanes separately so the caller demotes only the failed one."""
        from datum.worktree_manager import LaneMergeError, merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")

        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        wt_b = repo.parent / "wt-partial-b"
        _git(["worktree", "add", str(wt_b), lane_b], cwd=repo)
        (wt_b / "a.txt").write_text("conflicting content\n")
        _git(["add", "a.txt"], cwd=wt_b)
        _git(["commit", "-q", "-m", "lane b conflicts with lane a's a.txt"], cwd=wt_b)
        _git(["worktree", "remove", "--force", str(wt_b)], cwd=repo)

        _git(["checkout", "epic/test"], cwd=repo)
        before_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()

        with pytest.raises(LaneMergeError) as excinfo:
            merge_lane_branches(
                "epic/test", ["lane-a", "lane-b"], "merge: partial", repo_root=repo
            )

        err = excinfo.value
        assert isinstance(err, RuntimeError)
        assert err.failed_lane == "lane-b"
        assert err.merged == ["lane-a"]
        assert err.already_merged == []
        head = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        assert err.sha == head
        assert "lane-b" in str(err) and "lane-a" in str(err)
        after_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()
        assert len(after_log) == len(before_log) + 1
        assert (
            _git(["log", "-1", "--format=%s"], cwd=repo).stdout.strip()
            == "merge: partial"
        )
        assert (repo / "a.txt").read_text() == "work in progress\n"
        assert _git(["status", "--porcelain"], cwd=repo).stdout == ""

    def test_conflict_in_first_lane_leaves_epic_head_untouched(self, repo: Path):
        from datum.worktree_manager import LaneMergeError, merge_lane_branches

        (repo / "s.txt").write_text("base\n")
        _git(["add", "s.txt"], cwd=repo)
        _git(["commit", "-q", "-m", "base: s.txt"], cwd=repo)
        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        wt_a = repo.parent / "wt-first-conflict"
        _git(["worktree", "add", str(wt_a), lane_a], cwd=repo)
        (wt_a / "s.txt").write_text("lane a\n")
        _git(["add", "s.txt"], cwd=wt_a)
        _git(["commit", "-q", "-m", "lane a edits s.txt"], cwd=wt_a)
        _git(["worktree", "remove", "--force", str(wt_a)], cwd=repo)
        (repo / "s.txt").write_text("epic moved on\n")
        _git(["add", "s.txt"], cwd=repo)
        _git(["commit", "-q", "-m", "epic edits s.txt"], cwd=repo)
        head_before = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()

        with pytest.raises(LaneMergeError) as excinfo:
            merge_lane_branches("epic/test", ["lane-a"], "merge: x", repo_root=repo)

        assert excinfo.value.failed_lane == "lane-a"
        assert excinfo.value.merged == []
        assert excinfo.value.sha == head_before
        assert _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip() == head_before
        assert _git(["status", "--porcelain"], cwd=repo).stdout == ""

    def test_fold_commit_failure_restores_a_clean_checkout_and_is_a_lane_merge_error(
        self, repo: Path
    ):
        """Review finding: when the final fold commit failed (e.g. a commit-msg
        hook rejected the message) a bare RuntimeError escaped, HEAD had
        already been reset --soft to the start sha, and the squashed lane
        changes were left STAGED on the root checkout — a dirty, half-merged
        state with no payload saying what landed. The lanes' work is safe on
        their lane branches, so the right outcome is: hard-reset to the start
        sha (clean checkout, nothing landed) and a LaneMergeError whose
        payload says merged=[] so every lane is demoted and retried."""
        from datum.worktree_manager import LaneMergeError, merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")
        hook = repo / ".git" / "hooks" / "commit-msg"
        hook.write_text(
            '#!/usr/bin/env bash\ngrep -q "^tmp(datum)" "$1" || { echo "rejected: only tmp commits" >&2; exit 1; }\n'
        )
        hook.chmod(0o755)
        _git(["config", "core.hooksPath", ".git/hooks"], cwd=repo)
        _git(["checkout", "epic/test"], cwd=repo)
        start = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()

        with pytest.raises(LaneMergeError) as excinfo:
            merge_lane_branches(
                "epic/test", ["lane-a"], "merge: hooked", repo_root=repo
            )

        err = excinfo.value
        assert err.merged == []
        assert err.failed_lane == ""
        assert err.sha == start
        assert "rejected: only tmp commits" in str(err)
        assert _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip() == start
        assert _git(["status", "--porcelain"], cwd=repo).stdout == ""
        assert not (repo / "a.txt").exists()

    def test_worktrees_merge_cli_reports_any_merge_runtime_error_as_json(
        self, repo: Path, monkeypatch: pytest.MonkeyPatch
    ):
        """Every RuntimeError out of merge_lane_branches (untracked-file
        collision, checkout failure, ...) must reach the workflow as JSON on
        stdout with exit 1, never as a traceback the batch cannot parse."""
        import json

        from typer.testing import CliRunner

        from datum.cli import app

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")
        _git(["checkout", "epic/test"], cwd=repo)
        (repo / "a.txt").write_text("untracked collision\n")  # untracked at a lane path
        monkeypatch.chdir(repo)

        res = CliRunner().invoke(
            app,
            [
                "worktrees",
                "merge",
                "--epic-branch",
                "epic/test",
                "--lane-order",
                "lane-a",
                "--commit-message",
                "m",
            ],
        )
        assert res.exit_code == 1, res.output
        payload = json.loads(res.output.strip().splitlines()[-1])
        assert payload["merged"] == []
        assert payload["failed_lane"] == ""
        assert "Untracked working tree files" in payload["error"]
        assert payload["sha"] == _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()

    def test_worktrees_merge_cli_reports_a_partial_merge_as_json_with_exit_1(
        self, repo: Path, monkeypatch: pytest.MonkeyPatch
    ):
        """The TS merge workflow reads the CLI's stdout: on a partial failure it
        needs the merged lanes and the failed lane as JSON, not a traceback."""
        import json

        from typer.testing import CliRunner

        from datum.cli import app

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")
        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        wt_b = repo.parent / "wt-cli-b"
        _git(["worktree", "add", str(wt_b), lane_b], cwd=repo)
        (wt_b / "a.txt").write_text("conflicting content\n")
        _git(["add", "a.txt"], cwd=wt_b)
        _git(["commit", "-q", "-m", "lane b conflicts"], cwd=wt_b)
        _git(["worktree", "remove", "--force", str(wt_b)], cwd=repo)
        _git(["checkout", "epic/test"], cwd=repo)

        monkeypatch.chdir(repo)
        res = CliRunner().invoke(
            app,
            [
                "worktrees",
                "merge",
                "--epic-branch",
                "epic/test",
                "--lane-order",
                "lane-a,lane-b",
                "--commit-message",
                "merge: cli",
            ],
        )
        assert res.exit_code == 1, res.output
        payload = json.loads(res.output.strip().splitlines()[-1])
        assert payload["failed_lane"] == "lane-b"
        assert payload["merged"] == ["lane-a"]
        assert payload["sha"] == _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        assert "lane-b" in payload["error"]

    def test_untracked_file_at_lane_added_path_blocks_merge_precondition(
        self, repo: Path
    ):
        """BUG A2: an untracked file in the root checkout at a path a lane
        branch adds must be caught by an explicit precondition BEFORE any
        merging starts, not surface as a mid-merge git RuntimeError after
        earlier lanes have already been squash-merged."""
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")

        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        wt_b = repo.parent / "wt-untracked-b"
        _git(["worktree", "add", str(wt_b), lane_b], cwd=repo)
        (wt_b / "skeleton.py").write_text("stub\n")
        _git(["add", "skeleton.py"], cwd=wt_b)
        _git(["commit", "-q", "-m", "lane b adds skeleton.py"], cwd=wt_b)
        _git(["worktree", "remove", "--force", str(wt_b)], cwd=repo)

        _git(["checkout", "epic/test"], cwd=repo)
        (repo / "skeleton.py").write_text("untracked stub, not committed\n")

        before_head = _git(["rev-parse", "epic/test"], cwd=repo).stdout.strip()

        with pytest.raises(RuntimeError, match="skeleton.py"):
            merge_lane_branches(
                "epic/test", ["lane-a", "lane-b"], "merge: untracked", repo_root=repo
            )

        after_head = _git(["rev-parse", "epic/test"], cwd=repo).stdout.strip()
        assert after_head == before_head, "no merge should have happened"

        # Nothing staged either — not even lane-a, whose changes don't
        # conflict with anything. The precondition must run before ANY lane
        # is merged.
        status = _git(["status", "--porcelain"], cwd=repo).stdout
        assert "a.txt" not in status
        assert "A  a.txt" not in status

    def test_already_merged_lane_returns_epic_head_with_already_merged_flag(
        self, repo: Path
    ):
        """BUG (elonchesd run wf_6bfbd9f2-510): when a lane's commits are
        already squashed into the epic branch, `git merge --squash` stages
        nothing and `git commit` fails with "nothing to commit". The fix:
        detect this with `git diff --cached --quiet` and return the epic
        HEAD sha with `already_merged` flag instead of raising RuntimeError."""
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")

        # Squash the lane into epic via manual merge (simulating prior integration).
        _git(["checkout", "epic/test"], cwd=repo)
        _git(["merge", "--squash", "--no-commit", lane_a], cwd=repo)
        _git(["commit", "-q", "-m", "prior squash of lane-a"], cwd=repo)

        epic_head_before = _git(["rev-parse", "epic/test"], cwd=repo).stdout.strip()
        before_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()

        # Now try to merge the same lane again.
        result = merge_lane_branches(
            "epic/test", ["lane-a"], "merge: retry lane-a", repo_root=repo
        )

        # Should succeed with no new commit, epic HEAD as sha, and already_merged flag.
        assert result["sha"] == epic_head_before
        assert result["merged"] == ["lane-a"]
        assert result["already_merged"] == ["lane-a"]
        after_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()
        # No new commit created.
        assert len(after_log) == len(before_log)

    def test_new_lane_still_produces_squash_commit_as_before(self, repo: Path):
        """Verify that new lanes (with real commits not yet on epic) still
        produce a squash commit as the original implementation did."""
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "new_file.txt")

        _git(["checkout", "epic/test"], cwd=repo)
        before_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()

        result = merge_lane_branches(
            "epic/test", ["lane-a"], "merge: new lane", repo_root=repo
        )

        # Should produce a new commit.
        assert result["sha"]
        assert result["merged"] == ["lane-a"]
        assert result["already_merged"] == []
        after_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()
        assert len(after_log) == len(before_log) + 1
        assert (repo / "new_file.txt").exists()

    def test_conflicting_squash_merge_leaves_root_checkout_clean_after_raise(
        self, repo: Path
    ):
        """BUG (elonchesd runs wf_93040d99-e3c, wf_c8cd6517-117): a conflicting
        `git merge --squash` used to leave the ROOT checkout mid-merge
        (SQUASH_MSG/MERGE_MSG present, AA conflict markers in the working
        tree) after merge_lane_branches raised. The caller only sees the
        RuntimeError — nothing else runs `git merge --abort`/`git reset` — so
        every subsequent git operation in that checkout (including a later
        retry of merge_lane_branches itself) inherits the conflicted state.
        The fix: reset/abort the in-progress merge BEFORE raising, so the
        checkout is exactly as clean as it was before this call started."""
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        wt_a = repo.parent / "wt-clean-a"
        _git(["worktree", "add", str(wt_a), lane_a], cwd=repo)
        (wt_a / "shared.txt").write_text("from lane a\n")
        _git(["add", "shared.txt"], cwd=wt_a)
        _git(["commit", "-q", "-m", "lane a edits shared.txt"], cwd=wt_a)
        _git(["worktree", "remove", "--force", str(wt_a)], cwd=repo)

        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        wt_b = repo.parent / "wt-clean-b"
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

        assert not (repo / ".git" / "SQUASH_MSG").exists()
        assert not (repo / ".git" / "MERGE_MSG").exists()
        assert not (repo / ".git" / "MERGE_HEAD").exists()
        status = _git(["status", "--porcelain"], cwd=repo).stdout
        assert status == ""

    def test_mixed_order_already_merged_and_new_lanes(self, repo: Path):
        """When merge order contains both already-merged and new lanes,
        must produce exactly one commit with only the new lane's changes,
        mark the already-merged lane, and continue to merge the new lane."""
        from datum.worktree_manager import merge_lane_branches

        lane_a = _make_lane_branch(repo, "epic/test", "lane-a")
        _add_lane_commit(repo, lane_a, "a.txt")

        lane_b = _make_lane_branch(repo, "epic/test", "lane-b")
        _add_lane_commit(repo, lane_b, "b.txt")

        # Squash lane-a into epic (making it already-merged).
        _git(["checkout", "epic/test"], cwd=repo)
        _git(["merge", "--squash", "--no-commit", lane_a], cwd=repo)
        _git(["commit", "-q", "-m", "prior squash of lane-a"], cwd=repo)

        before_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()
        epic_head_after_a = _git(["rev-parse", "epic/test"], cwd=repo).stdout.strip()

        # Merge both lanes: lane-a (already merged) then lane-b (new).
        result = merge_lane_branches(
            "epic/test", ["lane-a", "lane-b"], "merge: a+b", repo_root=repo
        )

        # Should produce exactly one new commit (from lane-b only).
        assert result["merged"] == ["lane-a", "lane-b"]
        assert result["already_merged"] == ["lane-a"]
        after_log = _git(["log", "--oneline"], cwd=repo).stdout.splitlines()
        assert len(after_log) == len(before_log) + 1
        # New commit should have b.txt (from lane-b), and lane-a's a.txt should exist.
        assert (repo / "a.txt").exists()
        assert (repo / "b.txt").exists()
        # The sha should be the new commit, not the epic head from before lane-b merge.
        assert result["sha"] != epic_head_after_a


class TestHousekeepEpicMergedRelativeToEpicNotHead:
    def test_deletes_lane_merged_into_epic_even_when_head_is_another_branch(
        self, repo: Path
    ):
        """`git branch --merged` with no ref means "merged into HEAD"; housekeep
        must judge against the EPIC branch it was given. Closeout can run with
        a different branch checked out (root worktree detached, operator on
        main), in which case a lane fully merged into the epic looked unmerged
        and survived — or, worse, a lane merged into HEAD but not the epic
        could be deleted."""
        epic_branch = "epic/test"
        lane = _make_lane_branch(repo, epic_branch, "task-a")
        _add_lane_commit(repo, lane, "lane_work.py")
        # `other` forks from the epic BEFORE the lane lands, so the lane is
        # merged into the epic but not into `other`.
        _git(["branch", "other", epic_branch], cwd=repo)
        _git(["checkout", "-q", epic_branch], cwd=repo)
        _git(["merge", "-q", "--ff-only", lane], cwd=repo)
        _git(["checkout", "-q", "other"], cwd=repo)

        result = housekeep_epic(epic_branch, repo_root=repo)

        assert result["deleted_branches"] == [lane]
        check = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", lane],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        assert check.returncode != 0

    def test_does_not_delete_lane_merged_into_head_but_not_the_epic(self, repo: Path):
        epic_branch = "epic/test"
        lane = _make_lane_branch(repo, epic_branch, "task-b")
        _add_lane_commit(repo, lane, "lane_b_work.py")
        # `other` takes the lane's commit; the epic does not.
        _git(["branch", "other", lane], cwd=repo)
        _git(["checkout", "-q", "other"], cwd=repo)

        result = housekeep_epic(epic_branch, repo_root=repo)

        assert result["deleted_branches"] == []
        check = subprocess.run(
            ["git", "rev-parse", "--verify", "--quiet", lane],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        assert check.returncode == 0, "lane not merged into the epic must survive"


class TestArgumentInjectionValidation:
    """Security: values that originate from lane-plan.json / tasks.json / CLI
    args (epic_branch, run_id, lane_id, base_sha) must never reach `git` as a
    bare positional argv element that starts with '-' — git would parse it
    as an OPTION instead of a ref/path, changing command semantics (e.g.
    epic_branch="--merged" turned into `git branch --merged --merged`-style
    reinterpretation, or run_id="-D" landing next to `git branch -D`).
    Every such value must be rejected with ValueError/RuntimeError BEFORE any
    git subprocess runs, while ordinary values with '/' and '.' still work."""

    def test_create_lane_worktree_rejects_dash_prefixed_run_id(self, repo: Path):
        from datum.worktree_manager import create_lane_worktree

        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        with pytest.raises(ValueError):
            create_lane_worktree("epic/test", "lane-a", "-D", base_sha, repo_root=repo)

    def test_create_lane_worktree_rejects_dash_prefixed_lane_id(self, repo: Path):
        from datum.worktree_manager import create_lane_worktree

        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        with pytest.raises(ValueError):
            create_lane_worktree("epic/test", "-D", "run-1", base_sha, repo_root=repo)

    def test_create_lane_worktree_rejects_dash_prefixed_epic_branch(self, repo: Path):
        from datum.worktree_manager import create_lane_worktree

        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        with pytest.raises(ValueError):
            create_lane_worktree(
                "--merged", "lane-a", "run-1", base_sha, repo_root=repo
            )

    def test_create_lane_worktree_rejects_dash_prefixed_base_sha(self, repo: Path):
        from datum.worktree_manager import create_lane_worktree

        with pytest.raises(ValueError):
            create_lane_worktree(
                "epic/test", "lane-a", "run-1", "--upload-pack=evil", repo_root=repo
            )

    def test_create_lane_worktree_allows_slashes_and_dots_in_epic_branch(
        self, repo: Path
    ):
        from datum.worktree_manager import create_lane_worktree

        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        wt_path = create_lane_worktree(
            "epic/test", "lane-a", "run-1", base_sha, repo_root=repo
        )
        assert wt_path.is_dir()

    def test_setup_pipeline_worktrees_rejects_dash_prefixed_epic_branch(
        self, repo: Path
    ):
        from datum.worktree_manager import setup_pipeline_worktrees

        with pytest.raises(ValueError):
            setup_pipeline_worktrees("run-1", "--merged", ["lane-a"], repo_root=repo)

    def test_merge_lane_branches_rejects_dash_prefixed_epic_branch(self, repo: Path):
        from datum.worktree_manager import merge_lane_branches

        with pytest.raises(ValueError):
            merge_lane_branches("--force", ["task-a"], "msg", repo_root=repo)

    def test_merge_lane_branches_rejects_dash_prefixed_lane_id(self, repo: Path):
        from datum.worktree_manager import merge_lane_branches

        with pytest.raises(ValueError):
            merge_lane_branches("epic/test", ["-D"], "msg", repo_root=repo)

    def test_cleanup_run_worktrees_rejects_dash_prefixed_epic_branch(self, repo: Path):
        from datum.worktree_manager import cleanup_run_worktrees

        with pytest.raises(ValueError):
            cleanup_run_worktrees("run-1", "--merged", repo_root=repo)

    def test_housekeep_epic_rejects_dash_prefixed_epic_branch(self, repo: Path):
        from datum.worktree_manager import housekeep_epic

        with pytest.raises(ValueError):
            housekeep_epic("--merged", repo_root=repo)

    def test_remove_lane_worktree_fails_open_on_dash_prefixed_epic_branch(
        self, repo: Path
    ):
        """remove_lane_worktree fails OPEN (returns a not-deleted dict rather
        than raising) for run_id/lane_id per its docstring; a hostile
        epic_branch must be refused the same way, never reach `git`."""
        from datum.worktree_manager import remove_lane_worktree

        result = remove_lane_worktree("lane-a", "run-1", "--merged", repo_root=repo)
        assert result["deleted"] is False
        assert result["preserved"] is False
