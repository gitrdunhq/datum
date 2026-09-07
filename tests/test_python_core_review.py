"""Python core review (Sonnet sweep of worktree_manager / gate / cli, 2026-09-05).

Each test pins one defect found by reading the source: a crash between a
lane's temporary squash commit and the fold left that tmp commit on the epic
branch forever; H1 headings escaped the refine gate's section checks; the
required-sections check matched prose; the review gate only saw four literal
severity spellings; pipeline-state-save raised a traceback when git failed.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from datum import gate


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=True)


@pytest.fixture
def epic(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(["init", "-q", "-b", "epic/test"], cwd=repo)
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo)
    _git(["config", "user.email", "t@example.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    (repo / "README.md").write_text("base\n")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-q", "-m", "base"], cwd=repo)
    return repo


def _lane(repo: Path, lane_id: str, filename: str) -> None:
    branch = f"epic/test--{lane_id}"
    _git(["branch", branch, "epic/test"], cwd=repo)
    wt = repo.parent / f"wt-{lane_id}"
    _git(["worktree", "add", str(wt), branch], cwd=repo)
    (wt / filename).write_text(f"{lane_id}\n")
    _git(["add", filename], cwd=wt)
    _git(["commit", "-q", "-m", f"green({lane_id}): GREEN complete"], cwd=wt)
    _git(["worktree", "remove", "--force", str(wt)], cwd=repo)


def test_merge_retry_after_a_crash_folds_the_leftover_tmp_commit(epic: Path):
    """Crash between lane-a's `tmp(datum): squash lane` commit and the fold,
    then a retry of the same merge: the epic branch must end with ONE merge
    commit on top of the pre-merge base, no tmp commit left behind."""
    from datum.worktree_manager import merge_lane_branches

    _lane(epic, "lane-a", "a.txt")
    _lane(epic, "lane-b", "b.txt")
    base = _git(["rev-parse", "HEAD"], cwd=epic).stdout.strip()
    # Simulate the crashed first attempt: lane-a squashed and tmp-committed.
    _git(["merge", "--squash", "--no-commit", "epic/test--lane-a"], cwd=epic)
    _git(["commit", "-q", "-m", "tmp(datum): squash lane lane-a"], cwd=epic)

    result = merge_lane_branches("epic/test", ["lane-a", "lane-b"], "act(r1): merge 2 lanes", repo_root=epic)

    log = _git(["log", "--format=%s", f"{base}..HEAD"], cwd=epic).stdout.splitlines()
    assert log == ["act(r1): merge 2 lanes"], log
    assert (epic / "a.txt").exists() and (epic / "b.txt").exists()
    assert sorted(result["merged"]) == ["lane-a", "lane-b"]
    assert result["sha"] == _git(["rev-parse", "HEAD"], cwd=epic).stdout.strip()


def test_h1_headings_are_seen_by_the_section_checks():
    spec = "# Open Questions\n\n- TBD: which DB?\n\n# Requirements\n\nThe API must be appropriate.\n"
    assert gate.check_open_questions(spec), "an H1 Open Questions section with a TBD must trip the check"
    assert gate._extract_section(spec, "Requirements") is not None


def test_required_section_is_a_heading_not_a_word_in_prose():
    prose = "# Summary\n\nSee the requirements above; failure modes are discussed elsewhere.\n"
    assert gate._has_section(prose, "Summary") is True
    assert gate._has_section(prose, "Requirements") is False
    assert gate._has_section("## 3. Failure modes\n\ntext\n", "Failure modes") is True


@pytest.mark.parametrize(
    "spelling",
    ["Priority: High", "Sev: HIGH", "| High |", "severity:critical", "Severity: **Critical**"],
)
def test_review_gate_sees_severity_spellings_beyond_the_four_literals(spelling: str):
    assert gate._report_has_high_or_critical(f"## Findings\n\n- F1 — {spelling} — description\n") is True
    assert gate._report_has_high_or_critical("## Findings\n\n- F1 — Severity: low — description\n") is False


def test_pipeline_state_save_reports_a_git_failure_as_json_not_a_traceback(monkeypatch, tmp_path: Path):
    from datum.cli import app

    monkeypatch.chdir(tmp_path)
    with (
        patch("datum.pipeline_state.verify_phase", return_value=(True, "")),
        patch("subprocess.run") as mock_run,
    ):
        mock_run.return_value.stdout = ""
        mock_run.return_value.stderr = "fatal: not a git repository"
        mock_run.return_value.returncode = 128
        result = CliRunner().invoke(app, ["pipeline-state-save", "--phase", "plan", "--run-id", "20260101-000000", "--route", "feature"])
    assert result.exit_code == 1
    assert "Traceback" not in result.output
    payload = json.loads(result.output)
    assert payload["verified"] is False
    assert "git rev-parse" in payload["reason"]
