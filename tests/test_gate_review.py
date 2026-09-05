"""Characterization tests for gate_review() in datum/gate.py.

gate_review is the producer/consumer fix (#368): the gate used to read
REVIEW-REPORT.md from the repo root and require review-packets/unified.json
— an artifact no phase in the pipeline ever produces (datum-review.ts writes
docs/epics/<branch>/REVIEW-REPORT.md directly). These tests pin the fixed
behaviour: epic-scoped report resolution via resolve_artifact, no
review-packets requirement, the severity-driven satisfaction loop, and
human-approval policy parity with the other gates.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from datum import gate


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, check=True
    )


def _init_repo(repo: Path, branch: str = "datum/epic-review") -> str:
    repo.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q", "-b", branch], cwd=repo)
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo)
    _git(["config", "user.email", "t@example.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    (repo / "README.md").write_text("# fixture\n")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-q", "-m", "init"], cwd=repo)
    return branch


def _fail_json(capsys):
    """gate_review can print progress lines (e.g. remediation-package
    generation) before the final JSON verdict — take the last non-blank
    line, which is always the JSON payload."""
    lines = [line for line in capsys.readouterr().out.splitlines() if line.strip()]
    return json.loads(lines[-1])


@pytest.fixture
def epic_repo(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)
    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    return epic_dir


def _write_report(epic_dir: Path, body: str) -> None:
    (epic_dir / "REVIEW-REPORT.md").write_text(body)


# ── existence / resolution ───────────────────────────────────────────────


def test_missing_report_fails(epic_repo, capsys):
    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    assert _fail_json(capsys) == {
        "passed": False,
        "hard_stop": False,
        "message": "REVIEW-REPORT.md not found",
    }


def test_finds_report_in_epic_dir_not_root(epic_repo, capsys):
    """Regression: gate_review used to hardcode Path("REVIEW-REPORT.md") at
    the repo root, but datum-review.ts writes docs/epics/<branch>/REVIEW-REPORT.md.
    A repo-root-only lookup would never find it."""
    _write_report(epic_repo, "# Review Report\n\nNo findings.\n")

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Review gate passed"}


def test_no_review_packets_requirement(epic_repo, capsys):
    """Regression: gate_review used to hard-fail when review-packets/ or
    review-packets/unified.json was missing. Nothing in the pipeline produces
    that artifact, so a clean report must pass without it existing anywhere."""
    _write_report(epic_repo, "# Review Report\n\nNo findings.\n")
    assert not (Path("review-packets")).exists()

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Review gate passed"}


# ── severity-driven satisfaction loop ────────────────────────────────────


def test_report_with_high_severity_finding_fails(epic_repo, capsys):
    _write_report(
        epic_repo,
        "# Review Report\n\n| ID | Severity |\n|---|---|\n| SEC-01 | **high** |\n",
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert "high-severity findings" in message


def test_report_with_only_medium_low_findings_passes(epic_repo, capsys):
    _write_report(
        epic_repo,
        "# Review Report\n\n| ID | Severity |\n|---|---|\n| PERF-01 | **medium** |\n| ARCH-01 | **low** |\n",
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Review gate passed"}


def test_critical_finding_also_fails(epic_repo, capsys):
    _write_report(
        epic_repo,
        "# Review Report\n\nseverity: critical — SQL injection in auth.py\n",
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    assert "high-severity findings" in _fail_json(capsys)["message"]


def test_third_iteration_hard_stops(epic_repo, capsys):
    _write_report(epic_repo, "severity: high finding\n")
    run_id = "default"
    iter_file = Path(f".datum/runs/{run_id}/.review-iteration")
    iter_file.parent.mkdir(parents=True, exist_ok=True)
    iter_file.write_text("3")

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 2
    result = _fail_json(capsys)
    assert result["hard_stop"] is True
    assert "ESCALATION" in result["message"]


def test_remediation_skipped_when_no_producer_artifacts_exist(epic_repo, capsys):
    """No review-packets/unified.json producer exists (see gate.py comment).
    In this fixture repo neither datum/remediate.py nor a findings file
    exists, so the gate must fail cleanly on the severity check alone
    without attempting (and crashing on) a remediation subprocess call."""
    assert not Path("datum/remediate.py").exists()
    _write_report(epic_repo, "severity: high finding\n")

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    assert "high-severity findings" in _fail_json(capsys)["message"]


# ── human-approval policy parity with the other gates ────────────────────


def test_non_yolo_needs_human_approval(epic_repo, capsys):
    _write_report(epic_repo, "# Review Report\n\nNo findings.\n")

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(False, {})

    assert exc.value.code == 1
    result = _fail_json(capsys)
    assert result["passed"] is False
    assert result["needs_human"] is True
    assert result["message"] == (
        "REVIEW-REPORT.md ready for human approval. Re-run with --approve to approve."
    )


def test_yolo_passes_without_approval(epic_repo, capsys):
    _write_report(epic_repo, "# Review Report\n\nNo findings.\n")

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Review gate passed"}


def test_non_yolo_skips_approval_when_policy_skipped(epic_repo, capsys):
    _write_report(epic_repo, "# Review Report\n\nNo findings.\n")

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(False, {"gates": {"review_human_approval": "skipped"}})

    assert exc.value.code == 0
    assert _fail_json(capsys) == {"passed": True, "message": "Review gate passed"}
