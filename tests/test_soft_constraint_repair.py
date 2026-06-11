"""Tests for soft-constraint repair on decide-boundary schemas.

Policy: display/length constraints REPAIR (truncate), correctness constraints REJECT.
- Over-long summary → truncated to max_length, decision validates (episode survives)
- Wrong tool_name (not in Literal/enum) → still rejects
- Truncation preserves the first N chars exactly
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from datum.schemas import (
    AgentDecision,
    ClassificationOverride,
    EscalationSignal,
    FailureClassification,
    GateVerdict,
    PriorArtFinding,
    PriorArtTaskResult,
    ReviewFinding,
    SecurityAuditResult,
    SecurityCheckResult,
    StepAction,
    StepPlan,
    StepResult,
    ToolCall,
    TriageDecision,
)

# ── AgentDecision: the primary decide-boundary model ──────────────────────


class TestAgentDecisionSoftRepair:
    """summary and tool_name length caps are display concerns — repair, don't reject."""

    def test_overlong_summary_truncated(self):
        """A >300-char summary is silently truncated to exactly 300 chars."""
        long_summary = "x" * 500
        d = AgentDecision(action="done", summary=long_summary)
        assert len(d.summary) == 300
        assert d.summary == "x" * 300

    def test_overlong_summary_preserves_first_n_chars(self):
        """Truncation preserves the first N chars exactly."""
        summary = "".join(chr(65 + (i % 26)) for i in range(400))
        d = AgentDecision(action="done", summary=summary)
        assert d.summary == summary[:300]

    def test_exact_length_summary_passes(self):
        """A summary at exactly 300 chars passes unchanged."""
        summary = "a" * 300
        d = AgentDecision(action="done", summary=summary)
        assert d.summary == summary

    def test_short_summary_passes(self):
        """A normal short summary passes unchanged."""
        d = AgentDecision(action="done", summary="All tests pass.")
        assert d.summary == "All tests pass."

    def test_overlong_tool_name_truncated(self):
        """tool_name >50 chars is truncated, not rejected."""
        long_name = "a" * 80
        d = AgentDecision(action="tool", tool_name=long_name)
        assert len(d.tool_name) == 50
        assert d.tool_name == "a" * 50


class TestAgentDecisionCorrectnessReject:
    """action (Literal) and type constraints are correctness — MUST reject."""

    def test_invalid_action_rejects(self):
        """action must be 'tool' or 'done' — wrong values must fail."""
        with pytest.raises(ValidationError):
            AgentDecision(action="invalid")

    def test_valid_tool_action(self):
        d = AgentDecision(action="tool", tool_name="read_file")
        assert d.action == "tool"

    def test_valid_done_action(self):
        d = AgentDecision(action="done", summary="Completed.")
        assert d.action == "done"


# ── Other decide-boundary models: soft constraints repair ─────────────────


class TestTriageDecisionRepair:
    def test_overlong_reason_truncated(self):
        long_reason = "r" * 300
        t = TriageDecision(decision="deepen", reason=long_reason)
        assert len(t.reason) == 200
        assert t.reason == "r" * 200

    def test_correctness_literal_rejects(self):
        with pytest.raises(ValidationError):
            TriageDecision(decision="invalid", reason="ok")


class TestClassificationOverrideRepair:
    def test_overlong_reason_truncated(self):
        c = ClassificationOverride(tier="patch", reason="z" * 300)
        assert len(c.reason) == 200

    def test_correctness_literal_rejects(self):
        with pytest.raises(ValidationError):
            ClassificationOverride(tier="invalid", reason="ok")


class TestGateVerdictRepair:
    def test_overlong_message_truncated(self):
        g = GateVerdict(passed=True, message="m" * 500)
        assert len(g.message) == 300
        assert g.message == "m" * 300


class TestFailureClassificationRepair:
    def test_overlong_reason_truncated(self):
        f = FailureClassification(category="REASONING", reason="f" * 400, retry=True)
        assert len(f.reason) == 200

    def test_correctness_literal_rejects(self):
        with pytest.raises(ValidationError):
            FailureClassification(category="WRONG", reason="ok", retry=True)


class TestReviewFindingRepair:
    def test_overlong_description_truncated(self):
        r = ReviewFinding(
            id="RF-001",
            severity="high",
            file="main.py",
            line=10,
            description="d" * 500,
            suggestion="s" * 500,
        )
        assert len(r.description) == 300
        assert len(r.suggestion) == 300

    def test_overlong_id_truncated(self):
        r = ReviewFinding(
            id="i" * 30,
            severity="high",
            file="main.py",
            line=10,
            description="desc",
            suggestion="fix",
        )
        assert len(r.id) == 20

    def test_correctness_literal_rejects(self):
        with pytest.raises(ValidationError):
            ReviewFinding(
                id="RF-001",
                severity="WRONG",
                file="main.py",
                line=10,
                description="desc",
                suggestion="fix",
            )


class TestEscalationSignalRepair:
    def test_overlong_reason_truncated(self):
        e = EscalationSignal(escalate=True, reason="e" * 400)
        assert len(e.reason) == 200


class TestStepActionRepair:
    def test_overlong_description_truncated(self):
        s = StepAction(action="analyze", description="d" * 120)
        assert len(s.description) == 80

    def test_correctness_literal_rejects(self):
        with pytest.raises(ValidationError):
            StepAction(action="invalid_action", description="ok")


class TestStepPlanRepair:
    def test_overlong_rationale_truncated(self):
        s = StepPlan(
            steps=[StepAction(action="analyze", description="step 1")],
            rationale="r" * 120,
        )
        assert len(s.rationale) == 80


class TestToolCallRepair:
    def test_overlong_tool_name_truncated(self):
        t = ToolCall(tool_name="t" * 80, tool_args={})
        assert len(t.tool_name) == 50


class TestStepResultRepair:
    def test_overlong_finding_truncated(self):
        s = StepResult(
            step_index=0,
            action="analyze",
            finding="f" * 120,
            evidence="e" * 120,
            recommendation="proceed",
            confidence=0.9,
            needs_more_turns=False,
        )
        assert len(s.finding) == 80
        assert len(s.evidence) == 80

    def test_correctness_literal_rejects(self):
        with pytest.raises(ValidationError):
            StepResult(
                step_index=0,
                action="invalid",
                finding="ok",
                evidence="ok",
                recommendation="proceed",
                confidence=0.9,
                needs_more_turns=False,
            )


class TestPriorArtFindingRepair:
    def test_overlong_fields_truncated(self):
        p = PriorArtFinding(
            source_type="github",
            url="u" * 600,
            name="n" * 200,
            relevance="high",
            license="l" * 80,
            verdict="use",
            rationale="r" * 500,
            reduces_loc=10,
        )
        assert len(p.url) == 500
        assert len(p.name) == 100
        assert len(p.license) == 50
        assert len(p.rationale) == 300

    def test_correctness_literal_rejects(self):
        with pytest.raises(ValidationError):
            PriorArtFinding(
                source_type="invalid",
                url="http://example.com",
                name="lib",
                relevance="high",
                license="MIT",
                verdict="use",
                rationale="good",
                reduces_loc=10,
            )


class TestPriorArtTaskResultRepair:
    def test_overlong_fields_truncated(self):
        p = PriorArtTaskResult(
            task_id="t" * 30,
            findings=[],
            recommendation="build",
            recommendation_rationale="r" * 500,
        )
        assert len(p.task_id) == 20
        assert len(p.recommendation_rationale) == 300


class TestSecurityCheckResultRepair:
    def test_overlong_details_truncated(self):
        s = SecurityCheckResult(status="clear", details="d" * 500)
        assert len(s.details) == 300


class TestSecurityAuditResultRepair:
    def test_overlong_fields_truncated(self):
        s = SecurityAuditResult(
            package="p" * 200,
            version="v" * 50,
            verdict="pass",
            checks={},
            risk_summary="r" * 500,
        )
        assert len(s.package) == 100
        assert len(s.version) == 30
        assert len(s.risk_summary) == 300
