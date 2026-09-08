"""Tests for datum.task_ids.next_task_number — a repo-wide counter that
computes max(existing committed ids) + 1, scanning committed content via
`git show HEAD:<path>` over paths from `git ls-tree -r HEAD --name-only`,
never a filesystem glob. This keeps uncommitted and other-branch ids out
of the count.

Fixtures build a HERMETIC temp git repo: GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM
are pointed away from the real machine config, core.hooksPath is disabled,
and an explicit user/author identity is set, so machine-global git hooks
(~/.config/git/hooks) and ~/.ignore cannot change fixture outcomes.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from datum.task_ids import next_task_number


def _hermetic_env(tmp_path: Path) -> dict:
    env = os.environ.copy()
    env["GIT_CONFIG_GLOBAL"] = str(tmp_path / "empty-gitconfig")
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_AUTHOR_NAME"] = "Datum Test"
    env["GIT_AUTHOR_EMAIL"] = "datum-test@example.com"
    env["GIT_COMMITTER_NAME"] = "Datum Test"
    env["GIT_COMMITTER_EMAIL"] = "datum-test@example.com"
    return env


def _git(args: list[str], cwd: Path, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True
    )


def _init_repo(repo_root: Path, env: dict) -> Path:
    repo_root.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q", "-b", "main"], repo_root, env)
    _git(["config", "core.hooksPath", "/dev/null"], repo_root, env)
    return repo_root


def _commit_file(
    repo_root: Path, rel_path: str, content: str, env: dict, message: str = "add file"
) -> None:
    path = repo_root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    _git(["add", rel_path], repo_root, env)
    _git(["commit", "-q", "-m", message], repo_root, env)


def test_returns_one_when_no_committed_id_matches_prefix(tmp_path: Path) -> None:
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(repo_root, "README.md", "hello\n", env)

    result = next_task_number(repo_root, "DAT")

    assert result == 1


def test_max_plus_one_across_ids_and_depends_on_entries(tmp_path: Path) -> None:
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    tasks_payload = {
        "tasks": [
            {"id": "DAT-3", "depends_on": []},
            {"id": "DAT-7", "depends_on": ["DAT-9"]},
        ]
    }
    _commit_file(
        repo_root,
        "docs/epics/e1/tasks.json",
        json.dumps(tasks_payload),
        env,
    )

    result = next_task_number(repo_root, "DAT")

    assert result == 10


def test_old_shape_ids_contribute_nothing_to_the_maximum(tmp_path: Path) -> None:
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    tasks_payload = {
        "tasks": [
            {"id": "task-001"},
            {"id": "task-INT-4"},
        ]
    }
    _commit_file(
        repo_root,
        "docs/epics/e1/tasks.json",
        json.dumps(tasks_payload),
        env,
    )

    result = next_task_number(repo_root, "DAT")

    assert result == 1


def test_different_prefix_id_does_not_raise_the_dat_counter(tmp_path: Path) -> None:
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    tasks_payload = {"tasks": [{"id": "ABC-99"}]}
    _commit_file(
        repo_root,
        "docs/epics/e1/tasks.json",
        json.dumps(tasks_payload),
        env,
    )

    result = next_task_number(repo_root, "DAT")

    assert result == 1


def test_uncommitted_working_tree_id_is_ignored(tmp_path: Path) -> None:
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/e1/tasks.json",
        json.dumps({"tasks": [{"id": "DAT-4"}]}),
        env,
    )
    baseline = next_task_number(repo_root, "DAT")
    assert baseline == 5

    uncommitted_path = repo_root / "docs" / "epics" / "e2" / "tasks.json"
    uncommitted_path.parent.mkdir(parents=True, exist_ok=True)
    uncommitted_path.write_text(json.dumps({"tasks": [{"id": "DAT-50"}]}))

    result = next_task_number(repo_root, "DAT")

    assert result == 5


def test_id_committed_only_on_another_branch_is_ignored(tmp_path: Path) -> None:
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/e1/tasks.json",
        json.dumps({"tasks": [{"id": "DAT-2"}]}),
        env,
    )
    baseline = next_task_number(repo_root, "DAT")
    assert baseline == 3

    _git(["checkout", "-q", "-b", "other-branch"], repo_root, env)
    _commit_file(
        repo_root,
        "docs/epics/e2/tasks.json",
        json.dumps({"tasks": [{"id": "DAT-99"}]}),
        env,
        message="add higher id on other branch",
    )
    _git(["checkout", "-q", "main"], repo_root, env)

    result = next_task_number(repo_root, "DAT")

    assert result == 3


def test_malformed_json_file_is_skipped_without_raising(tmp_path: Path) -> None:
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/e1/tasks.json",
        json.dumps({"tasks": [{"id": "DAT-5"}]}),
        env,
    )
    _commit_file(
        repo_root,
        "docs/epics/e2/tasks.json",
        "{not valid json,,,",
        env,
        message="add malformed tasks.json",
    )

    result = next_task_number(repo_root, "DAT")

    assert result == 6
