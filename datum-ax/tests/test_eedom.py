"""EedomReviewGate — honors eedom's REAL contract: `eedom evaluate ... --output-json <file>`
emitting his published ReviewDecision schema, which we map to our ReviewDecision (ADR-0006)."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

from datum_ax.contracts.review import DecisionVerdict, ReviewDecision, ReviewGate
from datum_ax.data.review.eedom import EedomReviewGate


def _runner_writing(payload: dict) -> Callable[[list[str]], None]:
    """Fake eedom: finds --output-json in the command and writes his decision JSON there."""

    def run(cmd: list[str]) -> None:
        out = cmd[cmd.index("--output-json") + 1]
        Path(out).write_text(json.dumps(payload), encoding="utf-8")

    return run


def test_satisfies_review_gate_port():
    assert isinstance(EedomReviewGate(), ReviewGate)


def test_approve_maps_through():
    payload = {"decision": "approve", "findings": [], "memo_text": "clean", "should_mark_unstable": False}
    decision = EedomReviewGate(runner=_runner_writing(payload)).evaluate("diff")
    assert isinstance(decision, ReviewDecision)
    assert decision.decision is DecisionVerdict.APPROVE
    assert not decision.is_blocking


def test_reject_with_findings_maps_faithfully():
    payload = {
        "decision": "reject",
        "findings": [
            {
                "severity": "high",
                "category": "vulnerability",
                "description": "CVE-2024-0001 in left-pad",
                "source_tool": "osv",
                "package_name": "left-pad",
                "version": "1.0.0",
            }
        ],
        "memo_text": "blocked",
        "should_mark_unstable": True,
    }
    decision = EedomReviewGate(runner=_runner_writing(payload)).evaluate("diff")
    assert decision.decision is DecisionVerdict.REJECT
    assert decision.is_blocking
    f = decision.findings[0]
    assert f.severity.value == "high" and f.category.value == "vulnerability"
    assert "CVE-2024-0001" in f.description and f.package_name == "left-pad"


def test_runner_error_is_fail_open():
    def boom(cmd: list[str]) -> None:
        raise RuntimeError("eedom binary missing")

    decision = EedomReviewGate(runner=boom).evaluate("diff")
    assert decision.decision is DecisionVerdict.NEEDS_REVIEW  # fail-open
    assert decision.is_blocking


def test_no_decision_file_is_fail_open():
    decision = EedomReviewGate(runner=lambda cmd: None).evaluate("diff")  # writes nothing
    assert decision.decision is DecisionVerdict.NEEDS_REVIEW
