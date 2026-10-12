"""`regenerate_command` rebuilds generated files after lanes squash-merge.

datum self-hosted run 20261012: lanes edited skills/src/*.ts, no lane owned
the generated skills/*.js bundles, and the next phases ran the pre-epic
bundles. With `regenerate_command` in .datum/config.json, `datum worktrees
merge` runs it once after the batch's lanes land and folds what it changed
into the same merge commit. A failing command keeps the lanes landed,
discards its partial output and fails the merge step by name.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.worktree_manager import LaneMergeError, merge_lane_branches

# Rebuilds out.gen from every src/*.txt, the shape of build-workflows.sh.
REGEN = "cat src/*.txt > out.gen"


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )


@pytest.fixture
def epic(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(["init", "-q", "-b", "epic/test"], cwd=repo)
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo)
    _git(["config", "user.email", "t@example.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    (repo / "src").mkdir()
    (repo / "src" / "a.txt").write_text("a0\n")
    (repo / "out.gen").write_text("a0\n")
    _git(["add", "-A"], cwd=repo)
    _git(["commit", "-q", "-m", "base"], cwd=repo)
    return repo


def _lane(repo: Path, lane_id: str, rel: str, text: str) -> None:
    branch = f"epic/test--{lane_id}"
    _git(["branch", branch, "epic/test"], cwd=repo)
    wt = repo.parent / f"wt-{lane_id}"
    _git(["worktree", "add", "-q", str(wt), branch], cwd=repo)
    (wt / rel).parent.mkdir(parents=True, exist_ok=True)
    (wt / rel).write_text(text)
    _git(["add", rel], cwd=wt)
    _git(["commit", "-q", "-m", f"green({lane_id})"], cwd=wt)
    _git(["worktree", "remove", "--force", str(wt)], cwd=repo)


def _subjects(repo: Path, base: str) -> list[str]:
    return _git(["log", "--format=%s", f"{base}..HEAD"], cwd=repo).stdout.splitlines()


def test_regenerated_output_lands_in_the_one_merge_commit(epic: Path):
    # Catches: merged sources with stale generated files on the epic branch.
    _lane(epic, "L1", "src/a.txt", "a1\n")
    _lane(epic, "L2", "src/b.txt", "b1\n")
    base = _git(["rev-parse", "HEAD"], cwd=epic).stdout.strip()
    result = merge_lane_branches(
        "epic/test",
        ["L1", "L2"],
        "act(r): merge 2 lanes",
        repo_root=epic,
        regenerate_command=REGEN,
    )
    assert _subjects(epic, base) == ["act(r): merge 2 lanes"]
    assert _git(["show", "HEAD:out.gen"], cwd=epic).stdout == "a1\nb1\n"
    assert result["regenerated"] == ["out.gen"]
    assert _git(["status", "--porcelain"], cwd=epic).stdout == ""


def test_no_command_configured_leaves_behaviour_and_payload_unchanged(epic: Path):
    # Catches: the opt-in changing repos that never set it.
    _lane(epic, "L1", "src/a.txt", "a1\n")
    result = merge_lane_branches("epic/test", ["L1"], "m", repo_root=epic)
    assert "regenerated" not in result
    assert _git(["show", "HEAD:out.gen"], cwd=epic).stdout == "a0\n"


def test_a_command_that_changes_nothing_reports_an_empty_list(epic: Path):
    _lane(epic, "L1", "notes.md", "n\n")
    result = merge_lane_branches(
        "epic/test", ["L1"], "m", repo_root=epic, regenerate_command=REGEN
    )
    assert result["regenerated"] == []


def test_pre_existing_untracked_files_are_not_swept_into_the_commit(epic: Path):
    # Catches: `git add -A` committing the operator's scratch files.
    (epic / "scratch.txt").write_text("mine\n")
    _lane(epic, "L1", "src/a.txt", "a1\n")
    merge_lane_branches(
        "epic/test", ["L1"], "m", repo_root=epic, regenerate_command=REGEN
    )
    tracked = _git(["ls-files"], cwd=epic).stdout.splitlines()
    assert "scratch.txt" not in tracked
    assert (epic / "scratch.txt").read_text() == "mine\n"


def test_a_failing_command_keeps_the_lanes_and_fails_by_name(epic: Path):
    # Catches: a broken build either rolling back good lanes or passing
    # silently with half-written output committed.
    _lane(epic, "L1", "src/a.txt", "a1\n")
    base = _git(["rev-parse", "HEAD"], cwd=epic).stdout.strip()
    cmd = "echo partial > out.gen; echo boom >&2; exit 3"
    with pytest.raises(LaneMergeError) as info:
        merge_lane_branches(
            "epic/test", ["L1"], "m", repo_root=epic, regenerate_command=cmd
        )
    err = info.value
    assert err.failed_lane == ""
    assert err.merged == ["L1"]
    assert (
        "regenerate_command" in str(err) and "exit 3" in str(err) and "boom" in str(err)
    )
    assert _subjects(epic, base) == ["m"]
    assert _git(["show", "HEAD:src/a.txt"], cwd=epic).stdout == "a1\n"
    assert _git(["show", "HEAD:out.gen"], cwd=epic).stdout == "a0\n"
    assert _git(["status", "--porcelain"], cwd=epic).stdout == ""
    assert err.payload()["regenerate_failed"] is True


def test_a_failing_command_leaves_the_operators_dirty_files_alone(epic: Path):
    # Catches: a blanket `git reset --hard` destroying uncommitted work in
    # the main checkout while undoing the command.
    (epic / "notes.md").write_text("tracked\n")
    _git(["add", "notes.md"], cwd=epic)
    _git(["commit", "-q", "-m", "notes"], cwd=epic)
    (epic / "notes.md").write_text("operator edit\n")
    _lane(epic, "L1", "src/a.txt", "a1\n")
    with pytest.raises(LaneMergeError):
        merge_lane_branches(
            "epic/test",
            ["L1"],
            "m",
            repo_root=epic,
            regenerate_command="echo half > new.gen; exit 1",
        )
    assert (epic / "notes.md").read_text() == "operator edit\n"
    assert not (epic / "new.gen").exists()


def test_already_merged_lanes_do_not_run_the_command(epic: Path):
    # Catches: a retry paying for a full rebuild when nothing new landed.
    _lane(epic, "L1", "src/a.txt", "a1\n")
    merge_lane_branches("epic/test", ["L1"], "m", repo_root=epic)
    result = merge_lane_branches(
        "epic/test", ["L1"], "m2", repo_root=epic, regenerate_command="exit 9"
    )
    assert result["already_merged"] == ["L1"]
    assert result["regenerated"] == []


def test_the_cli_reads_regenerate_command_from_the_config(epic: Path, monkeypatch):
    # Catches: the option existing in the library but never wired to the
    # `datum worktrees merge` the merge batch runs.
    from datum.cli import app

    (epic / ".datum").mkdir()
    (epic / ".datum" / "config.json").write_text(
        json.dumps({"regenerate_command": REGEN})
    )
    (epic / ".git" / "info" / "exclude").write_text(".datum/\n")
    _lane(epic, "L1", "src/a.txt", "a1\n")
    monkeypatch.chdir(epic)
    r = CliRunner().invoke(
        app,
        [
            "worktrees",
            "merge",
            "--epic-branch",
            "epic/test",
            "--lane-order",
            "L1",
            "--commit-message",
            "m",
        ],
    )
    assert r.exit_code == 0, r.output
    out = json.loads(r.output.strip().splitlines()[-1])
    assert out["regenerated"] == ["out.gen"]
    assert _git(["show", "HEAD:out.gen"], cwd=epic).stdout == "a1\n"
