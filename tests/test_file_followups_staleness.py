"""#453 — closeout's follow-up filer retained findings without re-checking
them against later commits. In one run three of five retained follow-ups
had already been fixed by the operator's review-round commits.

file_followups.py now checks each unfiled finding that names a file (and
optionally a symbol) against the current tree before filing or retaining
it: a deleted file, or a cited symbol no longer present in that file,
marks the finding `stale_since: <HEAD sha>` and excludes it from filing.
A finding with no file citation is never marked stale (conservative by
design — see the module docstring).

Uses a self-contained hermetic git fixture (explicit -b main branch,
core.hooksPath disabled, isolated user config) rather than the repo
fixture in test_file_followups.py, which is not hardened against global
git hook/config leakage (see project memory:
global_git_env_leaks_into_tests).
"""

from __future__ import annotations

import json
import os
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
    _git(["init", "-q", "-b", "main"], cwd=repo_root)
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo_root)
    _git(["config", "user.email", "test@example.com"], cwd=repo_root)
    _git(["config", "user.name", "Test"], cwd=repo_root)
    (repo_root / "README.md").write_text("hello\n")
    _git(["add", "README.md"], cwd=repo_root)
    _git(["commit", "-q", "-m", "init"], cwd=repo_root)
    return repo_root


def _manifest(repo_root: Path, run_id: str) -> Path:
    p = repo_root / ".datum" / "runs" / run_id / "follow-ups.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _run_file_followups(repo_root: Path, run_id: str, min_severity: str = "info"):
    # This venv's `datum` may be editable-installed against a sibling
    # checkout — PYTHONPATH must point subprocess imports back at *this*
    # worktree's file_followups.py, or the test silently exercises someone
    # else's code (see #482 commit for the same discovery).
    worktree_root = Path(__file__).resolve().parents[1]
    return subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.closeout.file_followups",
            "--run-id",
            run_id,
            "--tracker",
            "local",
            "--min-severity",
            min_severity,
        ],
        cwd=repo_root,
        capture_output=True,
        text=True,
        env={**os.environ, "PYTHONPATH": str(worktree_root)},
    )


def _item(dedup_key: str, **overrides) -> dict:
    base = {
        "dedup_key": dedup_key,
        "title": "Follow-up",
        "body": "Details",
        "severity": "high",
        "source": "closeout-collector",
    }
    base.update(overrides)
    return base


def test_finding_whose_file_was_deleted_is_marked_stale_and_not_filed(repo):
    (repo / "worker.py").write_text("def process():\n    pass\n")
    _git(["add", "worker.py"], cwd=repo)
    _git(["commit", "-q", "-m", "add worker.py"], cwd=repo)
    _git(["rm", "-q", "worker.py"], cwd=repo)
    _git(["commit", "-q", "-m", "delete worker.py"], cwd=repo)
    head = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()

    _manifest(repo, "run-001").write_text(
        json.dumps([_item("k1", body="Flaky test in worker.py:12 needs a retry")])
    )

    result = _run_file_followups(repo, "run-001")
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("stale", 0) == 1
    assert output.get("retained", 0) == 0
    assert output.get("filed", 0) == 0

    on_disk = json.loads(_manifest(repo, "run-001").read_text())
    assert len(on_disk) == 1
    assert on_disk[0]["stale_since"] == head


def test_finding_whose_cited_symbol_is_gone_is_marked_stale(repo):
    (repo / "worker.py").write_text("def process_batch():\n    pass\n")
    _git(["add", "worker.py"], cwd=repo)
    _git(["commit", "-q", "-m", "add worker.py"], cwd=repo)
    head = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()

    _manifest(repo, "run-002").write_text(
        json.dumps(
            [
                _item(
                    "k2",
                    body="`old_symbol` in worker.py is a race condition",
                )
            ]
        )
    )

    result = _run_file_followups(repo, "run-002")
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("stale", 0) == 1

    on_disk = json.loads(_manifest(repo, "run-002").read_text())
    assert on_disk[0]["stale_since"] == head


def test_finding_whose_file_and_symbol_still_exist_is_retained_not_stale(repo):
    (repo / "worker.py").write_text("def process_batch():\n    pass\n")
    _git(["add", "worker.py"], cwd=repo)
    _git(["commit", "-q", "-m", "add worker.py"], cwd=repo)

    _manifest(repo, "run-003").write_text(
        json.dumps(
            [
                _item(
                    "k3",
                    body="`process_batch` in worker.py has an off-by-one",
                )
            ]
        )
    )

    result = _run_file_followups(repo, "run-003")
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("stale", 0) == 0
    assert output.get("retained", 0) == 1

    on_disk = json.loads(_manifest(repo, "run-003").read_text())
    assert "stale_since" not in on_disk[0]


def test_finding_with_no_file_citation_is_never_marked_stale(repo):
    _manifest(repo, "run-004").write_text(
        json.dumps(
            [_item("k4", body="The retry policy is too aggressive across the board")]
        )
    )

    result = _run_file_followups(repo, "run-004")
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("stale", 0) == 0
    assert output.get("retained", 0) == 1

    on_disk = json.loads(_manifest(repo, "run-004").read_text())
    assert "stale_since" not in on_disk[0]


def test_prose_that_looks_like_a_path_is_not_treated_as_a_file_citation(repo):
    """ "e.g." and version strings ("18.20.1") match a naive path-shaped
    regex but are not file citations — a finding whose body merely
    contains them must never be marked stale."""
    _manifest(repo, "run-006").write_text(
        json.dumps(
            [
                _item(
                    "k6",
                    body="e.g. pinned to node 18.20.1, the retry policy is too aggressive",
                )
            ]
        )
    )

    result = _run_file_followups(repo, "run-006")
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("stale", 0) == 0
    assert output.get("retained", 0) == 1

    on_disk = json.loads(_manifest(repo, "run-006").read_text())
    assert "stale_since" not in on_disk[0]


def test_a_symbol_on_a_different_line_from_the_cited_file_is_not_paired_with_it(repo):
    """A backticked identifier elsewhere in the body (naming an unrelated
    tool, not a symbol IN the cited file) must not be paired with a file
    citation on a different line just because both appear in the text."""
    (repo / "worker.py").write_text("def process_batch():\n    pass\n")
    _git(["add", "worker.py"], cwd=repo)
    _git(["commit", "-q", "-m", "add worker.py"], cwd=repo)

    _manifest(repo, "run-007").write_text(
        json.dumps(
            [
                _item(
                    "k7",
                    body="`gh` is not installed.\nSee worker.py:12 for the retry loop.",
                )
            ]
        )
    )

    result = _run_file_followups(repo, "run-007")
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("stale", 0) == 0
    assert output.get("retained", 0) == 1


def test_already_filed_findings_are_never_re_checked_for_staleness(repo):
    """A finding with filed_url set was already filed to the tracker in a
    prior run — it must not be re-evaluated (or silently dropped) even if
    its cited file has since vanished."""
    _manifest(repo, "run-005").write_text(
        json.dumps(
            [
                _item(
                    "k5",
                    body="See gone.py:1",
                    filed_url="https://example.com/issues/1",
                )
            ]
        )
    )

    result = _run_file_followups(repo, "run-005")
    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output.get("stale", 0) == 0
    assert output.get("filed", 0) == 1

    on_disk = json.loads(_manifest(repo, "run-005").read_text())
    assert "stale_since" not in on_disk[0]
