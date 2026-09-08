"""Tests for task_id_collision detection in `datum lane-plan --validate`.

find_task_id_collisions(repo_root, prefix, tasks) scans committed
docs/epics/*/tasks.json content at HEAD (mirroring datum.task_ids.next_task_number's
`git ls-tree` + `git show HEAD:<path>` approach — never a filesystem glob, and
never the uncommitted working tree) for ids matching `<PREFIX>-\\d+`, and
reports a collision when the same id is committed under two DIFFERENT
docs/epics/*/tasks.json paths.

`datum lane-plan --validate` wires this into its validate path: a collision
must exit non-zero with a JSON payload carrying code "task_id_collision",
the colliding id, and both conflicting paths. Schema-shape and topology
(cycle) failures must keep their own distinct codes and must never be
reported as task_id_collision.

Fixtures build a HERMETIC temp git repo: GIT_CONFIG_GLOBAL/GIT_CONFIG_SYSTEM
are pointed away from the real machine config, core.hooksPath is disabled,
and an explicit user/author identity is set, so machine-global git hooks
(~/.config/git/hooks) and ~/.ignore cannot change fixture outcomes. Mirrors
tests/test_task_id_counter.py.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from datum.lane_plan import find_task_id_collisions


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


def _valid_task(task_id: str, files: list[str] | None = None) -> dict:
    return {
        "id": task_id,
        "title": f"Task {task_id}",
        "acceptance_criteria": ["does the thing"],
        "files": files or [f"src/{task_id.lower().replace('-', '_')}.py"],
        "red_note": "n/a",
        "depends_on": [],
    }


def _run_validate(
    repo_root: Path, input_rel_path: str, env: dict
) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["datum", "lane-plan", "--validate", "--input", input_rel_path],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
    )


# ---------------------------------------------------------------------------
# AC1: find_task_id_collisions(repo_root, prefix, tasks) unit-level contract
# ---------------------------------------------------------------------------


def test_find_task_id_collisions_returns_record_with_id_and_both_paths(tmp_path):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/epic-a/tasks.json",
        json.dumps([_valid_task("DAT-9")]),
        env,
    )
    _commit_file(
        repo_root,
        "docs/epics/epic-b/tasks.json",
        json.dumps([_valid_task("DAT-9")]),
        env,
    )

    collisions = find_task_id_collisions(repo_root, "DAT", [_valid_task("DAT-9")])

    assert len(collisions) == 1
    record = collisions[0]
    assert record["id"] == "DAT-9"
    assert set(record["paths"]) == {
        "docs/epics/epic-a/tasks.json",
        "docs/epics/epic-b/tasks.json",
    }


# ---------------------------------------------------------------------------
# AC6: old-shape ids (task-001, task-INT-1) never participate as collisions
# ---------------------------------------------------------------------------


def test_old_shape_ids_shared_across_epics_are_not_reported_as_collisions(tmp_path):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/epic-a/tasks.json",
        json.dumps([_valid_task("task-001")]),
        env,
    )
    _commit_file(
        repo_root,
        "docs/epics/epic-b/tasks.json",
        json.dumps([_valid_task("task-001")]),
        env,
    )
    _commit_file(
        repo_root,
        "docs/epics/epic-c/tasks.json",
        json.dumps([_valid_task("task-INT-1")]),
        env,
    )
    _commit_file(
        repo_root,
        "docs/epics/epic-d/tasks.json",
        json.dumps([_valid_task("task-INT-1")]),
        env,
    )

    collisions = find_task_id_collisions(
        repo_root, "DAT", [_valid_task("task-001"), _valid_task("task-INT-1")]
    )

    assert collisions == []


# ---------------------------------------------------------------------------
# AC2: CLI --validate exits non-zero with code task_id_collision, the id and
# both conflicting paths
# ---------------------------------------------------------------------------


def test_cli_validate_reports_task_id_collision_across_merged_epics(tmp_path):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/epic-other/tasks.json",
        json.dumps([_valid_task("DAT-42", files=["src/other.py"])]),
        env,
    )
    _commit_file(
        repo_root,
        "docs/epics/epic-self/tasks.json",
        json.dumps([_valid_task("DAT-42", files=["src/self.py"])]),
        env,
        message="add epic-self before edit",
    )
    # Now mutate epic-self's own file uncommitted (still colliding with the
    # already-committed epic-other copy) so the current validation input is
    # a real edit under review, not a byte-identical re-read of HEAD.
    self_path = repo_root / "docs/epics/epic-self/tasks.json"
    self_path.write_text(
        json.dumps([_valid_task("DAT-42", files=["src/self.py", "src/self2.py"])])
    )

    result = _run_validate(repo_root, "docs/epics/epic-self/tasks.json", env)

    assert result.returncode != 0, result.stdout
    payload = json.loads(result.stdout)
    assert payload.get("code") == "task_id_collision"
    assert payload.get("id") == "DAT-42"
    assert "docs/epics/epic-other/tasks.json" in payload.get("paths", [])
    assert "docs/epics/epic-self/tasks.json" in payload.get("paths", [])


# ---------------------------------------------------------------------------
# AC3: the SAME lane's own already-committed copy of itself is not a
# collision
# ---------------------------------------------------------------------------


def test_cli_validate_does_not_report_own_committed_copy_as_collision(tmp_path):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/epic-self/tasks.json",
        json.dumps([_valid_task("DAT-7")]),
        env,
    )

    result = _run_validate(repo_root, "docs/epics/epic-self/tasks.json", env)

    assert result.returncode == 0, result.stdout
    assert "task_id_collision" not in result.stdout
    payload = json.loads(result.stdout)
    assert payload.get("valid") is True


# ---------------------------------------------------------------------------
# AC4: no collision -> no task_id_collision entry, exit 0
# ---------------------------------------------------------------------------


def test_cli_validate_reports_no_collision_entry_when_ids_do_not_overlap(tmp_path):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    _commit_file(
        repo_root,
        "docs/epics/epic-a/tasks.json",
        json.dumps([_valid_task("DAT-1")]),
        env,
    )
    _commit_file(
        repo_root,
        "docs/epics/epic-b/tasks.json",
        json.dumps([_valid_task("DAT-2")]),
        env,
    )

    result = _run_validate(repo_root, "docs/epics/epic-b/tasks.json", env)

    assert result.returncode == 0, result.stdout
    assert "task_id_collision" not in result.stdout
    payload = json.loads(result.stdout)
    assert payload.get("valid") is True


# ---------------------------------------------------------------------------
# AC5: schema-shape and topology (cycle) failures keep their own distinct
# codes; task_id_collision is never emitted for them and never downgraded
# to a generic error
# ---------------------------------------------------------------------------


def test_cli_validate_schema_shape_failure_has_its_own_code_not_collision(tmp_path):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    # missing required "red_note" field -> schema-shape failure
    broken_task = {
        "id": "DAT-3",
        "title": "Broken",
        "acceptance_criteria": ["x"],
        "files": ["src/broken.py"],
    }
    input_path = repo_root / "tasks.json"
    input_path.parent.mkdir(parents=True, exist_ok=True)
    input_path.write_text(json.dumps([broken_task]))

    result = _run_validate(repo_root, "tasks.json", env)

    assert result.returncode != 0, result.stdout
    payload = json.loads(result.stdout)
    schema_code = payload.get("code")
    assert schema_code is not None
    assert schema_code != "task_id_collision"


def test_cli_validate_cycle_failure_has_its_own_distinct_code(tmp_path):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)
    task_a = _valid_task("DAT-10", files=["src/a.py"])
    task_a["depends_on"] = ["DAT-11"]
    task_b = _valid_task("DAT-11", files=["src/b.py"])
    task_b["depends_on"] = ["DAT-10"]
    input_path = repo_root / "tasks.json"
    input_path.write_text(json.dumps([task_a, task_b]))

    result = _run_validate(repo_root, "tasks.json", env)

    assert result.returncode != 0, result.stdout
    payload = json.loads(result.stdout)
    cycle_code = payload.get("code")
    assert cycle_code is not None
    assert cycle_code != "task_id_collision"


def test_cli_validate_schema_and_cycle_failures_use_different_codes_from_each_other(
    tmp_path,
):
    env = _hermetic_env(tmp_path)
    repo_root = _init_repo(tmp_path / "repo", env)

    broken_task = {
        "id": "DAT-3",
        "title": "Broken",
        "acceptance_criteria": ["x"],
        "files": ["src/broken.py"],
    }
    schema_input = repo_root / "schema-tasks.json"
    schema_input.write_text(json.dumps([broken_task]))
    schema_result = _run_validate(repo_root, "schema-tasks.json", env)
    schema_payload = json.loads(schema_result.stdout)

    task_a = _valid_task("DAT-20", files=["src/a2.py"])
    task_a["depends_on"] = ["DAT-21"]
    task_b = _valid_task("DAT-21", files=["src/b2.py"])
    task_b["depends_on"] = ["DAT-20"]
    cycle_input = repo_root / "cycle-tasks.json"
    cycle_input.write_text(json.dumps([task_a, task_b]))
    cycle_result = _run_validate(repo_root, "cycle-tasks.json", env)
    cycle_payload = json.loads(cycle_result.stdout)

    assert schema_payload.get("code") is not None
    assert cycle_payload.get("code") is not None
    assert schema_payload.get("code") != cycle_payload.get("code")
