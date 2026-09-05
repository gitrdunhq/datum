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


# ── operator-accepted findings (elonchesd, epic-1 review iteration 1) ─────
# Five of six "high" findings were per-frame scans over forty items — an LLM
# lens's severity calibration was a hard block with no way to record a
# reasoned accept. And the gate claimed "Remediation Package generated"
# while nothing produces one in a consumer repo.

REPORT_TABLE = (
    "# Review Report\n\n## Findings\n\n"
    "| ID | Severity | File | Line | Description | Suggestion |\n"
    "|---|---|---|---|---|---|\n"
    "| CORR-001 | **high** | src/reducer.ts | 10 | promote accepts any toType | check |\n"
    "| PERF-001 | **high** | src/render.ts | 20 | Array.find per frame | index |\n"
    "| PERF-005 | **high** | src/engine.ts | 30 | O(256n) lookup | index |\n"
    "| ARCH-001 | **medium** | src/x.ts | 1 | small | small |\n"
)


def test_unaccepted_high_findings_fail_by_id_and_point_at_review_accept(
    epic_repo, capsys
):
    _write_report(epic_repo, REPORT_TABLE)

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    out = capsys.readouterr().out
    assert "Remediation Package" not in out
    message = json.loads([line for line in out.splitlines() if line.strip()][-1])[
        "message"
    ]
    assert "high-severity findings" in message
    assert "CORR-001, PERF-001, PERF-005" in message
    assert "datum review-accept" in message


def test_accepted_findings_are_ignored_and_the_pass_names_them(epic_repo, capsys):
    _write_report(epic_repo, REPORT_TABLE)
    (epic_repo / "REVIEW-RESPONSE.md").write_text(
        "# Review Response\n\n"
        "- ACCEPT PERF-001: 16x16 board, at most 40 pieces, microseconds per frame\n"
        "- ACCEPT PERF-005: same scale argument, engine hot path not measurable\n"
        "- ACCEPT CORR-001: fixed in 1a2b3c4\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    result = _fail_json(capsys)
    assert result["passed"] is True
    assert result["message"] == (
        "Review gate passed (3 accepted by REVIEW-RESPONSE.md: CORR-001, PERF-001, PERF-005)"
    )


def test_an_accept_without_a_reason_does_not_count(epic_repo, capsys):
    _write_report(epic_repo, REPORT_TABLE)
    (epic_repo / "REVIEW-RESPONSE.md").write_text(
        "- ACCEPT CORR-001:\n- ACCEPT PERF-001: fine\n- ACCEPT PERF-005: fine\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    assert "CORR-001" in _fail_json(capsys)["message"]


def test_review_accept_cli_writes_the_response_file_idempotently(epic_repo):
    from typer.testing import CliRunner

    from datum.cli import app

    runner = CliRunner()
    first = runner.invoke(
        app, ["review-accept", "PERF-001", "--reason", "40 pieces, microseconds"]
    )
    assert first.exit_code == 0, first.output
    again = runner.invoke(
        app, ["review-accept", "PERF-001", "--reason", "40 pieces, microseconds"]
    )
    assert again.exit_code == 0, again.output
    text = (epic_repo / "REVIEW-RESPONSE.md").read_text()
    assert text.count("ACCEPT PERF-001:") == 1
    assert "40 pieces, microseconds" in text
    assert gate.accepted_review_findings(epic_repo / "REVIEW-RESPONSE.md") == {
        "PERF-001": "40 pieces, microseconds"
    }
    empty = runner.invoke(app, ["review-accept", "PERF-002", "--reason", "  "])
    assert empty.exit_code == 1


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
