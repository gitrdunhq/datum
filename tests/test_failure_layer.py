"""
Tests for datum.failure_layer — FailureLayer enum and tag_escalation helper.

TDD order: all tests written before implementation was run; suite was confirmed
RED (ImportError on missing module) before the module was created.
"""

import json

import pytest

from datum.failure_layer import FailureLayer, tag_escalation


class TestFailureLayerEnum:
    """Enum membership and string-value contract."""

    def test_all_expected_members_present(self):
        names = {m.name for m in FailureLayer}
        assert names == {
            "CONTEXT",
            "CONSTRAINT",
            "VERIFICATION",
            "PLANNING",
            "INFRASTRUCTURE",
            "SPEC",
            "MODEL",
            "UNKNOWN",
        }

    def test_values_are_lowercase_strings(self):
        for member in FailureLayer:
            assert isinstance(member.value, str)
            assert member.value == member.value.lower()

    def test_string_identity(self):
        """StrEnum: the member IS its value in comparisons."""
        assert FailureLayer.CONTEXT == "context"
        assert FailureLayer.CONSTRAINT == "constraint"
        assert FailureLayer.VERIFICATION == "verification"
        assert FailureLayer.PLANNING == "planning"
        assert FailureLayer.INFRASTRUCTURE == "infrastructure"
        assert FailureLayer.SPEC == "spec"
        assert FailureLayer.MODEL == "model"
        assert FailureLayer.UNKNOWN == "unknown"

    def test_json_serialisable(self):
        """Values must survive a JSON round-trip without a custom encoder."""
        payload = {"layer": FailureLayer.VERIFICATION}
        serialised = json.dumps(payload)
        assert json.loads(serialised)["layer"] == "verification"


class TestFromReason:
    """FailureLayer.from_reason() maps diagnose_failure cause strings to layers."""

    # ── CONSTRAINT causes (from diagnose_failure _BUILTIN_HARD_STOP) ─────────
    @pytest.mark.parametrize(
        "reason",
        [
            "hook_blocked_write",
            "test_ratchet_violation",
            "lane_tool_sandbox_violation",
            "external_dependency_install",
            "budget_exhausted",
            "max_steps_exhausted",
        ],
    )
    def test_constraint_causes(self, reason):
        assert FailureLayer.from_reason(reason) == FailureLayer.CONSTRAINT

    # ── INFRASTRUCTURE causes (from _BUILTIN_ENVIRONMENTAL + agent_loop) ─────
    @pytest.mark.parametrize(
        "reason",
        [
            "stale_path",
            "stub_not_committed",
            "lint_fixable",
            "duplicate_commit",
            "dirty_working_tree",
            "merge_conflict_in_apply",
            "patch_apply_failed",
            "format_mismatch",
            "subagent_timeout",
            "timeout_exceeded",
        ],
    )
    def test_infrastructure_causes(self, reason):
        assert FailureLayer.from_reason(reason) == FailureLayer.INFRASTRUCTURE

    # ── VERIFICATION causes (from _BUILTIN_REASONING) ─────────────────────────
    @pytest.mark.parametrize(
        "reason",
        [
            "wrong_implementation",
            "ac_gap",
            "wrong_interpretation",
            "test_failure",
            "gate_failed",
        ],
    )
    def test_verification_causes(self, reason):
        assert FailureLayer.from_reason(reason) == FailureLayer.VERIFICATION

    # ── PLANNING causes ───────────────────────────────────────────────────────
    @pytest.mark.parametrize(
        "reason",
        [
            "tool_discovery_failure",
            "loop_detected",
            "no_progress",
            "orchestration_error",
        ],
    )
    def test_planning_causes(self, reason):
        assert FailureLayer.from_reason(reason) == FailureLayer.PLANNING

    # ── CONTEXT causes ────────────────────────────────────────────────────────
    @pytest.mark.parametrize(
        "reason",
        [
            "stale_context",
            "retrieval_failure",
            "memory_miss",
            "context_window_exceeded",
        ],
    )
    def test_context_causes(self, reason):
        assert FailureLayer.from_reason(reason) == FailureLayer.CONTEXT

    # ── MODEL causes ──────────────────────────────────────────────────────────
    @pytest.mark.parametrize(
        "reason",
        [
            "structured_output_decode_error",
            "llm_refusal",
            "model_timeout",
            "token_budget_exceeded",
        ],
    )
    def test_model_causes(self, reason):
        assert FailureLayer.from_reason(reason) == FailureLayer.MODEL

    # ── SPEC causes ───────────────────────────────────────────────────────────
    @pytest.mark.parametrize(
        "reason",
        [
            "ambiguous_spec",
            "missing_ac",
            "contradictory_spec",
        ],
    )
    def test_spec_causes(self, reason):
        assert FailureLayer.from_reason(reason) == FailureLayer.SPEC

    # ── UNKNOWN / edge cases ──────────────────────────────────────────────────
    def test_unrecognized_reason_returns_unknown(self):
        assert (
            FailureLayer.from_reason("totally_made_up_reason") == FailureLayer.UNKNOWN
        )

    def test_none_reason_returns_unknown(self):
        assert FailureLayer.from_reason(None) == FailureLayer.UNKNOWN

    def test_empty_string_returns_unknown(self):
        assert FailureLayer.from_reason("") == FailureLayer.UNKNOWN

    def test_unrecognized_pattern_cause_returns_unknown(self):
        assert FailureLayer.from_reason("unrecognized_pattern") == FailureLayer.UNKNOWN

    def test_case_insensitive_lookup(self):
        """Normalisation means TIMEOUT_EXCEEDED and timeout_exceeded both work."""
        assert (
            FailureLayer.from_reason("TIMEOUT_EXCEEDED") == FailureLayer.INFRASTRUCTURE
        )
        assert FailureLayer.from_reason("Loop_Detected") == FailureLayer.PLANNING


class TestFromClassification:
    """FailureLayer.from_classification() maps coarse diagnose_failure buckets."""

    def test_environmental_maps_to_infrastructure(self):
        assert (
            FailureLayer.from_classification("ENVIRONMENTAL")
            == FailureLayer.INFRASTRUCTURE
        )

    def test_reasoning_maps_to_planning(self):
        assert FailureLayer.from_classification("REASONING") == FailureLayer.PLANNING

    def test_hard_stop_maps_to_constraint(self):
        assert FailureLayer.from_classification("HARD_STOP") == FailureLayer.CONSTRAINT

    def test_unknown_maps_to_unknown(self):
        assert FailureLayer.from_classification("UNKNOWN") == FailureLayer.UNKNOWN

    def test_none_returns_unknown(self):
        assert FailureLayer.from_classification(None) == FailureLayer.UNKNOWN

    def test_unrecognised_string_returns_unknown(self):
        assert FailureLayer.from_classification("GIBBERISH") == FailureLayer.UNKNOWN

    def test_lowercase_input_accepted(self):
        assert (
            FailureLayer.from_classification("environmental")
            == FailureLayer.INFRASTRUCTURE
        )
        assert FailureLayer.from_classification("hard_stop") == FailureLayer.CONSTRAINT


class TestTagEscalation:
    """tag_escalation() builds JSON-safe event payloads."""

    def test_escalated_true_includes_layer(self):
        payload = tag_escalation(escalated=True, reason="loop_detected")
        assert payload["escalated"] is True
        assert payload["reason"] == "loop_detected"
        assert payload["failure_layer"] == "planning"

    def test_escalated_true_explicit_layer_overrides_derivation(self):
        payload = tag_escalation(
            escalated=True, reason="loop_detected", layer=FailureLayer.SPEC
        )
        assert payload["failure_layer"] == "spec"

    def test_escalated_false_layer_is_none(self):
        payload = tag_escalation(escalated=False, reason=None)
        assert payload["escalated"] is False
        assert payload["failure_layer"] is None

    def test_escalated_false_with_reason_layer_still_none(self):
        """A clean finish has no failure layer even if a reason string is present."""
        payload = tag_escalation(escalated=False, reason="some_reason")
        assert payload["failure_layer"] is None

    def test_extra_fields_merged(self):
        payload = tag_escalation(
            escalated=True,
            reason="timeout_exceeded",
            extra={"steps_taken": 7, "phase": "act"},
        )
        assert payload["steps_taken"] == 7
        assert payload["phase"] == "act"

    def test_unknown_reason_yields_unknown_layer(self):
        payload = tag_escalation(escalated=True, reason="totally_new_thing")
        assert payload["failure_layer"] == "unknown"

    def test_payload_is_json_serialisable(self):
        payload = tag_escalation(
            escalated=True, reason="wrong_implementation", extra={"run_id": "abc123"}
        )
        # Must not raise
        serialised = json.dumps(payload)
        loaded = json.loads(serialised)
        assert loaded["failure_layer"] == "verification"
        assert loaded["run_id"] == "abc123"

    def test_none_reason_escalated_yields_unknown_layer(self):
        payload = tag_escalation(escalated=True, reason=None)
        assert payload["failure_layer"] == "unknown"
