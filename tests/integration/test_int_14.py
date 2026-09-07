"""Integration invariants covering task-009, task-010.

This is a `kind: "integration"` lane (task-INT-14): its acceptance criteria
describe behaviour that task-009 (datum/closeout/archive.py) and task-010
(datum/closeout/collect_tasks.py, datum/closeout/collate.py) already merged.
Per contract_summary in this lane's spec, these tests are expected to PASS
against the already-merged code — a failing test here is a finding, not a
placeholder to be filled in during GREEN.

INV-9: The `no_state_available` sentinel produced by task-010's
collect_tasks collector (no lane-plan.json, no lane-state markers) survives
task-009's archive rewrite (datum/closeout/archive.py, which snapshots and
clears live state) and collate.py's rendering into closeout-data.json
unchanged — the tasks payload in the final artifact is exactly
`{"status": "no_state_available"}`, regardless of whether archive runs
before or after collect_tasks in the pipeline.
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


def _run_collect_tasks(repo_root: Path, run_id: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "datum.closeout.collect_tasks", "--run-id", run_id],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )


def _run_archive(repo_root: Path, run_id: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "datum.closeout.archive", "--run-id", run_id],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )


def _run_collate(
    repo_root: Path, run_id: str, merge_sha: str, epic_number: int = 1
) -> subprocess.CompletedProcess:
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


def _write_git_and_token_metrics(repo_root: Path, run_id: str) -> Path:
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
    (raw_dir / "token_metrics.json").write_text(
        json.dumps({"total_input": 10, "total_output": 20})
    )
    return raw_dir


def test_sentinel_survives_collect_then_archive_then_collate_unchanged(repo):
    """INV-9: collect_tasks writes the no_state_available sentinel first,
    archive.py runs on the same run-id afterwards (snapshotting/clearing
    live state), and collate.py renders closeout-data.json last. The tasks
    payload in the final artifact must be exactly the sentinel dict — no
    extra keys added, no keys dropped, no status flip — regardless of
    archive.py running in between."""
    run_id = "run-int14-a"
    _write_git_and_token_metrics(repo, run_id)

    collect_result = _run_collect_tasks(repo, run_id)
    assert collect_result.returncode == 0, collect_result.stdout + collect_result.stderr
    raw_tasks_path = repo / ".datum" / "runs" / run_id / "closeout-raw" / "tasks.json"
    raw_sentinel_before_archive = json.loads(raw_tasks_path.read_text())
    assert raw_sentinel_before_archive == {"status": "no_state_available"}

    archive_result = _run_archive(repo, run_id)
    assert archive_result.returncode == 0, archive_result.stdout + archive_result.stderr

    # The raw collector artifact must be byte-for-byte the same sentinel
    # after archive.py runs — archive.py must not touch closeout-raw/.
    raw_sentinel_after_archive = json.loads(raw_tasks_path.read_text())
    assert raw_sentinel_after_archive == {"status": "no_state_available"}

    collate_result = _run_collate(repo, run_id, _merge_sha(repo))
    assert collate_result.returncode == 0, collate_result.stdout + collate_result.stderr

    data = json.loads(
        (repo / ".datum" / "runs" / run_id / "closeout-data.json").read_text()
    )
    assert data["tasks"] == {"status": "no_state_available"}
    assert "tasks: no closeout-raw/tasks.json" not in " ".join(
        data.get("collector_warnings") or []
    )


def test_sentinel_survives_archive_running_before_collect_tasks(repo):
    """INV-9 (order independence): running archive.py before collect_tasks
    for the same run-id must not prevent collect_tasks from writing the
    sentinel, nor must it leak stale live-state data into the eventual
    closeout-data.json tasks payload."""
    run_id = "run-int14-b"
    raw_dir = _write_git_and_token_metrics(repo, run_id)

    archive_result = _run_archive(repo, run_id)
    assert archive_result.returncode == 0, archive_result.stdout + archive_result.stderr

    collect_result = _run_collect_tasks(repo, run_id)
    assert collect_result.returncode == 0, collect_result.stdout + collect_result.stderr
    raw_tasks_path = raw_dir / "tasks.json"
    assert json.loads(raw_tasks_path.read_text()) == {"status": "no_state_available"}

    collate_result = _run_collate(repo, run_id, _merge_sha(repo))
    assert collate_result.returncode == 0, collate_result.stdout + collate_result.stderr

    data = json.loads(
        (repo / ".datum" / "runs" / run_id / "closeout-data.json").read_text()
    )
    assert data["tasks"] == {"status": "no_state_available"}


def test_sentinel_status_value_is_not_mutated_by_the_full_pipeline(repo):
    """Negative/error-path guard: the specific string value
    "no_state_available" must not be altered, replaced by null, or
    replaced by a zeroed/empty payload anywhere along the
    collect -> archive -> collate pipeline."""
    run_id = "run-int14-c"
    _write_git_and_token_metrics(repo, run_id)

    collect_result = _run_collect_tasks(repo, run_id)
    assert collect_result.returncode == 0, collect_result.stdout + collect_result.stderr

    archive_result = _run_archive(repo, run_id)
    assert archive_result.returncode == 0, archive_result.stdout + archive_result.stderr

    collate_result = _run_collate(repo, run_id, _merge_sha(repo))
    assert collate_result.returncode == 0, collate_result.stdout + collate_result.stderr

    data = json.loads(
        (repo / ".datum" / "runs" / run_id / "closeout-data.json").read_text()
    )
    assert data["tasks"] is not None
    assert data["tasks"] != 0
    assert data["tasks"] != {}
    assert data["tasks"]["status"] == "no_state_available"
