"""Test for gate_prior_art()'s tasks.json path resolution bug.

Correctness bug (found via gate.py edge-case sweep): gate_prior_art used a
bare Path("tasks.json") instead of resolve_artifact("tasks.json") like
every other artifact lookup in this file. tasks.json is always written to
the epic dir (skills/src/datum-plan.ts writes "${epicDir}/tasks.json"),
never repo root, so `tasks_path.exists()` was always False in real usage —
the per-task PRIOR_ART.md coverage check silently never ran.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from datum.gate import gate_prior_art


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git"] + args, cwd=cwd, capture_output=True, text=True, check=True)


def _init_repo(repo: Path) -> str:
    repo.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q", "-b", "datum/epic-1"], cwd=repo)
    _git(["config", "user.email", "t@example.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    (repo / "README.md").write_text("# fixture\n")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-q", "-m", "init"], cwd=repo)
    return "datum/epic-1"


def test_gate_prior_art_reads_epic_dir_tasks_json_and_catches_missing_entry(
    tmp_path, monkeypatch
):
    """A tasks.json in the epic dir (the real-world location) with a task ID
    that PRIOR_ART.md never mentions must fail the gate — proving the check
    actually runs against the epic-dir copy, not a repo-root path that never
    exists in practice."""
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    (epic_dir / "PRIOR_ART.md").write_text(
        "# Prior Art\n\nNo entries reference any task yet.\n"
    )
    (epic_dir / "tasks.json").write_text(
        json.dumps({"tasks": [{"id": "task-001", "title": "Add widget"}]})
    )

    with pytest.raises(SystemExit) as exc_info:
        gate_prior_art(yolo=True, config={})

    assert exc_info.value.code != 0


def test_gate_prior_art_passes_when_epic_dir_tasks_json_is_covered(
    tmp_path, monkeypatch
):
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    (epic_dir / "PRIOR_ART.md").write_text(
        "# Prior Art\n\ntask-001: no reusable prior art found.\n"
    )
    (epic_dir / "tasks.json").write_text(
        json.dumps({"tasks": [{"id": "task-001", "title": "Add widget"}]})
    )
    (epic_dir / "TASKS.md").write_text("## Prior Art\n\nSee PRIOR_ART.md.\n")

    with pytest.raises(SystemExit) as exc_info:
        gate_prior_art(yolo=True, config={})

    assert exc_info.value.code == 0
