"""Targeted invariant property tests (DPS-12 domains) for the boundary contracts."""

from __future__ import annotations

import pytest
from hypothesis import given
from hypothesis import strategies as st
from pydantic import ValidationError

from datum_ax.contracts.execution import ApplyResult, Outcome, TestResult
from datum_ax.contracts.inference import TokenBudget
from datum_ax.contracts.review import DecisionVerdict
from datum_ax.contracts.status import InferenceStatus, WindowStatus
from datum_ax.schemas.rules import RuleKind, RuleRegistryEntry, RuleTier
from datum_ax.schemas.ticket import (
    Ambiguity,
    Classification,
    Complexity,
    Epic,
    Initiative,
    Route,
    Scope,
    Ticket,
    WorkScale,
)
from strategies import artifact_bundle_st, assembled_prompt_st, review_decision_st, window_status_st


class TestInvariants:
    @given(review_decision_st)
    def test_gate_blocks_iff_verdict_blocks(self, rd):
        # INVARIANT (eedom gate, ADR-0006): is_blocking is a pure function of the verdict.
        assert rd.is_blocking == (
            rd.decision in (DecisionVerdict.REJECT, DecisionVerdict.NEEDS_REVIEW)
        )

    @given(window=st.integers(min_value=1, max_value=100_000), extra=st.integers(min_value=1, max_value=100_000))
    def test_boundedness_input_must_fit_window(self, window, extra):
        # PERFORMANCE/Boundedness (ADR-0013): max_input > window_target is rejected.
        with pytest.raises(ValidationError):
            TokenBudget(window_target=window, max_input=window + extra, max_output=1)

    def test_boundedness_input_within_window_ok(self):
        TokenBudget(window_target=100, max_input=100, max_output=10)

    @given(run=st.integers(min_value=0, max_value=500), extra=st.integers(min_value=1, max_value=500))
    def test_boundedness_passed_within_run(self, run, extra):
        with pytest.raises(ValidationError):
            TestResult(
                outcome=Outcome.PASS, exit_code=0, duration_s=0.0,
                tests_run=run, tests_passed=run + extra,
            )

    @given(conflicts=st.lists(st.text(min_size=1), min_size=1, max_size=3).map(tuple))
    def test_atomicity_applied_has_no_conflicts(self, conflicts):
        # SAFETY/Atomicity (ADR-0012): partial apply (applied + conflicts) is impossible.
        with pytest.raises(ValidationError):
            ApplyResult(applied=True, conflicts=conflicts)

    def test_non_repudiation_rule_requires_evidence(self):
        # INVARIANT/Non-repudiation (ADR-0020): a learned rule must trace to evidence.
        with pytest.raises(ValidationError):
            RuleRegistryEntry(
                id="r1", kind=RuleKind.OPENGREP, tier=RuleTier.AUTO_BIND,
                statement="no innerHTML", evidence_refs=(), version=1,
            )

    def test_initiative_requires_multiple_epics(self):
        # ADR-0025: an initiative is many epics, never one.
        with pytest.raises(ValidationError):
            Initiative(intent="x", epics=(Epic(id="e1", title="t", intent="i", scope="s"),))

    def test_ticket_cannot_be_initiative_scale(self):
        c = Classification(
            complexity=Complexity.FEATURE, scope=Scope.NARROW,
            ambiguity=Ambiguity.LOW, suggested_route=Route.FEATURE,
        )
        with pytest.raises(ValidationError):
            Ticket(title="t", intent="i", scale=WorkScale.INITIATIVE, classification=c)

    @given(artifact_bundle_st)
    def test_artifact_total_bytes_sums(self, bundle):
        assert bundle.total_bytes == sum(a.size_bytes for a in bundle.artifacts)

    @given(assembled_prompt_st)
    def test_stable_prefix_is_deterministic(self, prompt):
        # Determinism (ADR-0003): the cache-stable prefix is reproducible.
        assert prompt.stable_prefix() == prompt.stable_prefix()
        assert prompt.system in prompt.stable_prefix()

    @given(active=st.integers(min_value=2, max_value=20), max_conn=st.integers(min_value=1, max_value=1))
    def test_live_inference_within_capacity(self, active, max_conn):
        # Boundedness (ADR-0029): live in-flight calls never exceed the semaphore capacity.
        with pytest.raises(ValidationError):
            InferenceStatus(active_calls=active, max_connections=max_conn)

    @given(window_status_st)
    def test_live_window_occupancy(self, ws):
        # Determinism: occupancy is a faithful function of tokens vs target.
        assert ws.occupancy_pct == round(100.0 * ws.tokens_in_window / ws.window_target, 2)
