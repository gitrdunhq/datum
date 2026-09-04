"""Tests for datum/closeout/file_followups.py's schema validation.

Bug: file_followups.py reads follow-ups.json (written by an LLM agent
during Closeout) and files each item via `gh issue create` using
permissive .get(..., default) fallbacks — a malformed item (missing
title/body/dedup_key, the FollowUpIssue schema's required fields) would
silently get filed as a near-empty "Follow-up" issue instead of being
rejected and reported.
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
    _git(["commit", "-q", "-m", "init"], cwd=repo_root)
    return repo_root


def _run_file_followups(repo_root: Path, run_id: str):
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.closeout.file_followups",
            "--run-id",
            run_id,
            "--tracker",
            "local",
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )


def test_malformed_followup_item_is_skipped_and_reported(repo):
    """A follow-up item missing required FollowUpIssue fields (title, body,
    dedup_key, source) must be reported as invalid, not silently filed with
    empty-default placeholders."""
    (repo / "follow-ups.json").write_text(
        json.dumps([{"severity": "high"}])  # missing dedup_key/title/body/source
    )

    result = _run_file_followups(repo, "run-001")

    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("invalid", 0) == 1
    assert output.get("filed", 0) == 0


def test_valid_followup_item_with_local_tracker_is_retained(repo):
    """A well-formed FollowUpIssue-shaped item passes validation and is
    processed normally (local tracker just retains it, doesn't file to gh)."""
    (repo / "follow-ups.json").write_text(
        json.dumps(
            [
                {
                    "dedup_key": "k1",
                    "title": "Flaky test in worker pool",
                    "body": "Details here",
                    "severity": "medium",
                    "source": "closeout-collector",
                }
            ]
        )
    )

    result = _run_file_followups(repo, "run-002")

    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("invalid", 0) == 0
    assert output.get("retained", 0) == 1
