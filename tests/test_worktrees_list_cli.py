"""Tests for `datum worktrees list` CLI subcommand.

Acceptance criteria:
1. `worktrees list` prints structured JSON for every registered worktree
   (path, sha, branch), matching `list_worktrees()`'s output shape.
2. `worktrees list --run-id X` filters to only worktrees under
   `.datum/worktrees/X/`, excluding worktrees from other runs.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, check=True
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    _git(["init", "-q"], cwd=repo_root)
    _git(["config", "user.email", "test@example.com"], cwd=repo_root)
    _git(["config", "user.name", "Test"], cwd=repo_root)
    (repo_root / "README.md").write_text("hello\n")
    _git(["add", "README.md"], cwd=repo_root)
    _git(["commit", "-q", "-m", "initial commit"], cwd=repo_root)
    return repo_root


def test_worktrees_list_prints_structured_json(repo, monkeypatch):
    """AC1: `worktrees list` prints JSON with path/sha/branch for each worktree."""
    monkeypatch.chdir(repo)
    _git(["branch", "lane-a", "HEAD"], cwd=repo)
    wt_dir = repo / ".datum" / "worktrees" / "run1" / "lane-a"
    wt_dir.parent.mkdir(parents=True)
    _git(["worktree", "add", str(wt_dir), "lane-a"], cwd=repo)

    runner = CliRunner()
    result = runner.invoke(app, ["worktrees", "list"])

    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    assert isinstance(data, list)
    paths = [w["path"] for w in data]
    assert any(str(wt_dir.resolve()) == p or str(wt_dir) in p for p in paths)
    assert all("branch" in w or "sha" in w for w in data)


def test_worktrees_list_filters_by_run_id(repo, monkeypatch):
    """AC2: `--run-id` excludes worktrees belonging to other runs."""
    monkeypatch.chdir(repo)
    _git(["branch", "lane-a", "HEAD"], cwd=repo)
    _git(["branch", "lane-b", "HEAD"], cwd=repo)
    wt_run1 = repo / ".datum" / "worktrees" / "run1" / "lane-a"
    wt_run2 = repo / ".datum" / "worktrees" / "run2" / "lane-b"
    wt_run1.parent.mkdir(parents=True)
    wt_run2.parent.mkdir(parents=True)
    _git(["worktree", "add", str(wt_run1), "lane-a"], cwd=repo)
    _git(["worktree", "add", str(wt_run2), "lane-b"], cwd=repo)

    runner = CliRunner()
    result = runner.invoke(app, ["worktrees", "list", "--run-id", "run1"])

    assert result.exit_code == 0, result.output
    data = json.loads(result.output)
    paths = [w["path"] for w in data]
    assert any("run1" in p for p in paths)
    assert not any("run2" in p for p in paths)
