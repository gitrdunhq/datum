"""EedomReviewGate (data tier) — maps eedom output to a typed ReviewDecision (ADR-0006)."""

from __future__ import annotations

from datum_ax.contracts.review import DecisionVerdict, ReviewDecision, ReviewGate
from datum_ax.data.review.eedom import EedomReviewGate


def _gate(output: str) -> EedomReviewGate:
    return EedomReviewGate(runner=lambda cmd, data: output)


def test_eedom_satisfies_review_gate_port():
    assert isinstance(EedomReviewGate(), ReviewGate)


def test_eedom_pass_maps_to_approve():
    decision = _gate('{"verdict": "PASS", "violations": []}').evaluate("diff")
    assert isinstance(decision, ReviewDecision)
    assert decision.decision is DecisionVerdict.APPROVE
    assert not decision.is_blocking
    assert decision.findings == ()


def test_eedom_fail_maps_to_reject_with_findings():
    decision = _gate('{"verdict": "FAIL", "violations": ["Missing type hint"]}').evaluate("bad")
    assert decision.decision is DecisionVerdict.REJECT
    assert decision.is_blocking
    assert any("Missing type hint" in f.description for f in decision.findings)


def test_eedom_error_is_fail_open_needs_review():
    def boom(cmd, data):
        raise RuntimeError("eedom not found")

    decision = EedomReviewGate(runner=boom).evaluate("diff")
    assert decision.decision is DecisionVerdict.NEEDS_REVIEW  # fail-open (ADR-0006)
    assert decision.is_blocking
