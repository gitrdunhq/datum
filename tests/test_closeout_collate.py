"""Tests for datum/closeout/collate.py's schema validation.

Bug: collate.py built closeout-data.json (documented in docs/DATUM.md as
"the sole input to synthesis stage" of Closeout) as a raw dict with zero
validation against the CloseoutData Pydantic schema that already exists —
a malformed/incomplete collector output would silently flow into the sole
input for RETRO.md generation. Also fixes a real pre-existing bug this
surfaces: merge_timestamp (a REQUIRED AwareDatetime field) was hardcoded
to None, which the schema would always reject once validated.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest


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
    _git(["commit", "-q", "-m", "merge commit"], cwd=repo_root)
    return repo_root


def _merge_sha(repo_root: Path) -> str:
    return _git(["rev-parse", "HEAD"], cwd=repo_root).stdout.strip()


def _run_collate(repo_root: Path, run_id: str, merge_sha: str, epic_number: int = 1):
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.closeout.collate",
            "--run-id",
            run_id,
            "--merge-sha",
            merge_sha,
            "--epic-number",
            str(epic_number),
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )


def _write_collector_outputs(repo_root: Path, run_id: str) -> Path:
    raw_dir = repo_root / ".datum" / "runs" / run_id / "closeout-raw"
    raw_dir.mkdir(parents=True)
    (raw_dir / "git.json").write_text(
        json.dumps(
            {
                "commits": [],
                "files_touched": ["a.py"],
                "loc_added": 1,
                "loc_removed": 0,
                "loc_net": 1,
            }
        )
    )
    (raw_dir / "tasks.json").write_text(
        json.dumps(
            {"total": 1, "completed": 1, "failed_terminal": 0, "say_do_ratio": 1.0}
        )
    )
    (raw_dir / "token_metrics.json").write_text(
        json.dumps({"total_input": 10, "total_output": 20})
    )
    return raw_dir


def test_collate_produces_valid_closeout_data_with_real_merge_timestamp(repo):
    """AC1: well-formed collector outputs + a real merge_sha produce a
    closeout-data.json that validates against CloseoutData, with a real
    (non-null) merge_timestamp derived from the actual commit."""
    run_id = "run-001"
    _write_collector_outputs(repo, run_id)
    merge_sha = _merge_sha(repo)

    result = _run_collate(repo, run_id, merge_sha)

    assert result.returncode == 0, result.stdout + result.stderr
    out_path = repo / ".datum" / "runs" / run_id / "closeout-data.json"
    assert out_path.exists()
    data = json.loads(out_path.read_text())
    assert data["merge_timestamp"] is not None

    from datum.models.closeout_data_schema import CloseoutData

    CloseoutData(**data)  # must not raise


def test_collate_fails_loudly_on_missing_required_collectors(repo):
    """AC2: missing git/tasks collector output (required fields) must fail
    the collate step loudly instead of writing a null-filled artifact."""
    run_id = "run-002"
    raw_dir = repo / ".datum" / "runs" / run_id / "closeout-raw"
    raw_dir.mkdir(parents=True)
    # No git.json / tasks.json written — required fields missing.
    merge_sha = _merge_sha(repo)

    result = _run_collate(repo, run_id, merge_sha)

    assert result.returncode != 0
    out_path = repo / ".datum" / "runs" / run_id / "closeout-data.json"
    assert not out_path.exists(), "must not write a malformed artifact"


def test_collate_fails_open_on_a_missing_tasks_collector_and_names_it(repo):
    """caliper BUG S: a missing OPTIONAL collector output (tasks) was a hard
    schema failure, so git.json + token_metrics.json — both fine — never
    reached synthesis. tasks becomes null with a named collector warning
    the synthesis agent can read; git stays required."""
    run_id = "run-003"
    raw_dir = _write_collector_outputs(repo, run_id)
    (raw_dir / "tasks.json").unlink()
    merge_sha = _merge_sha(repo)

    result = _run_collate(repo, run_id, merge_sha)

    assert result.returncode == 0, result.stdout + result.stderr
    out_path = repo / ".datum" / "runs" / run_id / "closeout-data.json"
    data = json.loads(out_path.read_text())
    assert data["tasks"] is None
    assert data["collector_warnings"] == [
        "tasks: no closeout-raw/tasks.json — collector did not run or failed"
    ]
    from datum.models.closeout_data_schema import CloseoutData

    CloseoutData(**data)


def test_collate_lifts_lanes_out_of_tasks(repo):
    run_id = "run-004"
    raw_dir = _write_collector_outputs(repo, run_id)
    (raw_dir / "tasks.json").write_text(
        json.dumps(
            {
                "total": 1,
                "completed": 1,
                "failed_terminal": 0,
                "say_do_ratio": 1.0,
                "lanes": [{"task_id": "task-001", "final_status": "completed"}],
            }
        )
    )
    result = _run_collate(repo, run_id, _merge_sha(repo))
    assert result.returncode == 0, result.stdout + result.stderr
    data = json.loads(
        (repo / ".datum" / "runs" / run_id / "closeout-data.json").read_text()
    )
    assert data["lanes"] == [{"task_id": "task-001", "final_status": "completed"}]
    assert "lanes" not in data["tasks"]


def test_collate_resolves_the_epic_number_from_the_branch_when_the_flag_is_absent(repo):
    """The closeout batch (skills/src/shared/lane-steps.ts closeoutCollectSteps)
    never passed --epic-number, so argparse exited 2 with a usage message and
    closeout-data.json was never written on ANY run. Without the flag, collate
    resolves the number the way `datum closeout` does: from the branch
    (datum/epic-23 -> 23), else the UNKNOWN sentinel, never a crash."""
    _git(["checkout", "-q", "-b", "datum/epic-23"], cwd=repo)
    run_id = "r-nb"
    _write_collector_outputs(repo, run_id)
    res = subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.closeout.collate",
            "--run-id",
            run_id,
            "--merge-sha",
            _merge_sha(repo),
        ],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr + res.stdout
    assert json.loads(res.stdout)["ok"] is True
    data = json.loads(
        (repo / ".datum" / "runs" / run_id / "closeout-data.json").read_text()
    )
    assert data["epic_number"] == 23


def test_collate_without_a_parseable_branch_uses_the_unknown_sentinel(repo):
    from datum.closeout_cmd import UNKNOWN_EPIC_NUMBER

    _git(["checkout", "-q", "-b", "feature/no-number-here"], cwd=repo)
    run_id = "r-nb2"
    _write_collector_outputs(repo, run_id)
    res = subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.closeout.collate",
            "--run-id",
            run_id,
            "--merge-sha",
            _merge_sha(repo),
        ],
        cwd=repo,
        capture_output=True,
        text=True,
    )
    assert res.returncode == 0, res.stderr + res.stdout
    data = json.loads(
        (repo / ".datum" / "runs" / run_id / "closeout-data.json").read_text()
    )
    assert data["epic_number"] == UNKNOWN_EPIC_NUMBER
