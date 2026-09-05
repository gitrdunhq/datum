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
    # Two DISTINCT blocked reports already seen for this epic; this one is
    # the third.
    iter_file = Path(".datum/epics/datum-epic-review/review-iterations.json")
    iter_file.parent.mkdir(parents=True, exist_ok=True)
    iter_file.write_text(json.dumps({"seen": ["a" * 40, "b" * 40]}))

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


# ── stable finding keys (elonchesd, review iteration 2) ──────────────────
# Finding ids are renumbered every iteration (iteration 1's PERF-001 became
# iteration 2's PERF-002), so ACCEPT-by-id accepted a different finding
# than the one reasoned about. The report carries a content key per row
# (lens + file + normalised description) and accepts bind to that key.

KEYED_REPORT = (
    "# Review Report\n\n## Findings\n\n"
    "| ID | Severity | File | Line | Description | Suggestion | Key |\n"
    "|---|---|---|---|---|---|---|\n"
    "| PERF-001 | **high** | src/fog.ts | 181 | visiblePiecesFor scans per frame | index | 9c1d2e3f |\n"
    "| PERF-002 | **high** | src/turn.ts | 39 | isStalemate Array.find per frame | index | 3fa9c1d2 |\n"
    "| CORR-001 | **high** | src/ui.ts | 5 | TECH_BUY unhandled | wire | ab12cd34 |\n"
)


def test_accept_by_key_survives_id_renumbering(epic_repo, capsys):
    _write_report(epic_repo, KEYED_REPORT)
    (epic_repo / "REVIEW-RESPONSE.md").write_text(
        "- ACCEPT 3fa9c1d2 (PERF-001 src/turn.ts:39): 40 pieces, microseconds\n"
        "- ACCEPT 9c1d2e3f: same scale argument\n"
        "- DEFER ab12cd34 -> datum/playable-ui-shell: fixed by the UI epic\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    result = _fail_json(capsys)
    assert result["passed"] is True
    assert "3 accepted" in result["message"]
    assert "3fa9c1d2" in result["message"] and "ab12cd34" in result["message"]


# caliper BUG R (eedom wf_40e67cca-a79): the key hashes the finding TEXT, so a
# reviewer that restates the same finding (same file, same line, same lens)
# produced a new key and the recorded DEFER stopped applying. A recorded
# decision also matches a row by lens + file + line, and the gate says so.
def test_a_reworded_refinding_matches_the_prior_decision_by_lens_file_and_line(
    epic_repo, capsys
):
    _write_report(
        epic_repo,
        "# Review Report\n\n## Findings\n\n"
        "| ID | Severity | File | Line | Description | Suggestion | Key |\n"
        "|---|---|---|---|---|---|---|\n"
        "| CORR-001 | **high** | src/part_framework.py | 34 | Framework-layout rules apply only to Django, restated | fix | 9b29b0f8 |\n"
        "| PERF-001 | **high** | src/part_framework.py | 90 | scan per call | index | 11112222 |\n",
    )
    (epic_repo / "REVIEW-RESPONSE.md").write_text(
        "- DEFER b0408cbd (CORR-001 src/part_framework.py:34) -> datum/next: R2.1 is the next epic\n"
        "- ACCEPT 33334444 (PERF-003 src/part_framework.py:90): fine\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    message = _fail_json(capsys)["message"]
    assert "matched prior decision b0408cbd" in message
    assert "9b29b0f8" in message
    assert "matched prior decision 33334444" in message


def test_a_prior_decision_matches_across_lenses_when_file_line_and_requirement_id_agree(
    epic_repo, capsys
):
    """caliper: the reviewer re-derives a finding from the requirement
    (R2.1); when a restatement lands under another lens at the same place
    and both cite the same requirement id, it is the same finding."""
    _write_report(
        epic_repo,
        "# Review Report\n\n## Findings\n\n"
        "| ID | Severity | File | Line | Description | Suggestion | Key |\n"
        "|---|---|---|---|---|---|---|\n"
        "| ARCH-002 | **high** | AGENTS.md | 133 | R2.1 scope rule restated under architecture | fix | 0049f593 |\n",
    )
    (epic_repo / "REVIEW-RESPONSE.md").write_text(
        "- DEFER 746f2805 (CORR-005 AGENTS.md:133) -> datum/next: R2.1 belongs to the next epic\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 0
    assert "0049f593 matched prior decision 746f2805" in _fail_json(capsys)["message"]


def test_a_prior_decision_on_another_line_or_lens_does_not_match(epic_repo, capsys):
    _write_report(
        epic_repo,
        "# Review Report\n\n## Findings\n\n"
        "| ID | Severity | File | Line | Description | Suggestion | Key |\n"
        "|---|---|---|---|---|---|---|\n"
        "| CORR-001 | **high** | src/part_framework.py | 60 | different finding | fix | 9b29b0f8 |\n"
        "| PERF-001 | **high** | src/part_framework.py | 34 | perf at the same line | index | 11112222 |\n",
    )
    (epic_repo / "REVIEW-RESPONSE.md").write_text(
        "- DEFER b0408cbd (CORR-001 src/part_framework.py:34) -> datum/next: R2.1\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert "CORR-001 [9b29b0f8]" in message
    assert "PERF-001 [11112222]" in message


def test_bare_id_accept_on_a_keyed_report_does_not_count_and_is_named(
    epic_repo, capsys
):
    _write_report(epic_repo, KEYED_REPORT)
    (epic_repo / "REVIEW-RESPONSE.md").write_text(
        "- ACCEPT PERF-001: reasoned about turn.ts, but PERF-001 now means fog.ts\n"
        "- ACCEPT 9c1d2e3f: fine\n- ACCEPT ab12cd34: fine\n"
    )

    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})

    assert exc.value.code == 1
    message = _fail_json(capsys)["message"]
    assert "PERF-002" in message
    assert "3fa9c1d2" in message
    assert "ACCEPT PERF-001 ignored" in message


def test_iterations_count_distinct_reports_not_gate_calls(epic_repo, capsys):
    """The counter hit 3 after two review runs: every gate call on the same
    report (an operator's manual `datum gate review`, a re-run) counted."""
    _write_report(epic_repo, KEYED_REPORT)
    for _ in range(3):
        with pytest.raises(SystemExit) as exc:
            gate.gate_review(True, {})
        assert exc.value.code == 1, "same report re-checked must not escalate"
        assert "(iteration 1/3)" in _fail_json(capsys)["message"]

    _write_report(epic_repo, KEYED_REPORT.replace("9c1d2e3f", "9c1d2e40"))
    with pytest.raises(SystemExit) as exc:
        gate.gate_review(True, {})
    assert exc.value.code == 1
    assert "(iteration 2/3)" in _fail_json(capsys)["message"]


def test_review_accept_cli_resolves_an_id_to_the_reports_key(epic_repo):
    from typer.testing import CliRunner

    from datum.cli import app

    _write_report(epic_repo, KEYED_REPORT)
    runner = CliRunner()
    result = runner.invoke(
        app, ["review-accept", "PERF-002", "--reason", "40 pieces, microseconds"]
    )
    assert result.exit_code == 0, result.output
    text = (epic_repo / "REVIEW-RESPONSE.md").read_text()
    assert (
        "- ACCEPT 3fa9c1d2 (PERF-002 src/turn.ts:39): 40 pieces, microseconds" in text
    )
    assert gate.accepted_review_findings(epic_repo / "REVIEW-RESPONSE.md") == {
        "3FA9C1D2": "40 pieces, microseconds"
    }
    deferred = runner.invoke(
        app,
        [
            "review-accept",
            "CORR-001",
            "--defer-to",
            "datum/playable-ui-shell",
            "--reason",
            "UI epic",
        ],
    )
    assert deferred.exit_code == 0, deferred.output
    assert (
        "- DEFER ab12cd34 (CORR-001 src/ui.ts:5) -> datum/playable-ui-shell: UI epic"
        in (epic_repo / "REVIEW-RESPONSE.md").read_text()
    )
    unknown = runner.invoke(app, ["review-accept", "PERF-009", "--reason", "x"])
    assert unknown.exit_code == 1
    assert "not in REVIEW-REPORT.md" in unknown.output


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
