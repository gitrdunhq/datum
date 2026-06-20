"""G7: deterministic RED-before-GREEN gate (ADR-0010)."""

from __future__ import annotations

from hypothesis import given
from hypothesis import strategies as st

from datum_ax.core.verifier.discipline import evaluate_tdd_gate
from datum_ax.schemas.verification import GateResult, LaneVerification


def test_impl_without_test_fails():
    r = evaluate_tdd_gate(
        LaneVerification(test_present=False, red_observed=False, impl_present=True)
    )
    assert isinstance(r, GateResult)
    assert not r.passed
    assert any("RED" in v for v in r.violations)


def test_impl_without_observed_red_fails():
    r = evaluate_tdd_gate(
        LaneVerification(test_present=True, red_observed=False, impl_present=True)
    )
    assert not r.passed


def test_red_then_green_passes():
    r = evaluate_tdd_gate(LaneVerification(test_present=True, red_observed=True, impl_present=True))
    assert r.passed
    assert r.violations == ()


def test_red_done_green_pending_is_ok():
    # A failing test exists but no impl yet — not a violation (GREEN simply pending).
    r = evaluate_tdd_gate(
        LaneVerification(test_present=True, red_observed=True, impl_present=False)
    )
    assert r.passed


class TestTddGateProperties:
    @given(
        test_present=st.booleans(),
        red_observed=st.booleans(),
        impl_present=st.booleans(),
    )
    def test_ordering_invariant(self, test_present, red_observed, impl_present):
        # SAFETY/Ordering: if the gate passes with an implementation, a RED was observed first.
        v = LaneVerification(
            test_present=test_present, red_observed=red_observed, impl_present=impl_present
        )
        r = evaluate_tdd_gate(v)
        if r.passed and v.impl_present:
            assert v.test_present and v.red_observed
