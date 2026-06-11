"""
failure_layer.py — Structured failure-layer vocabulary for datum escalations.

Classifies failures by WHERE in the stack they occurred, complementing
diagnose_failure.py's ENVIRONMENTAL/REASONING retry-strategy classification.

Layer taxonomy (from deepset harness-engineering failure-classification diagram):

  CONTEXT      — retrieval / memory failures: the agent had wrong, stale, or
                 missing context going into the episode.
  CONSTRAINT   — guardrail / policy failures: a hook, sandbox, or budget limit
                 blocked execution; the task itself was valid.
  VERIFICATION — feedback-loop failures: the agent produced output but
                 tests, gate, or acceptance-criteria checks rejected it.
  PLANNING     — orchestration / decomposition failures: the agent's strategy
                 or task decomposition was wrong.
  INFRASTRUCTURE — tooling / environment failures below the agent layer:
                 disk, network, subprocess, dependency issues.
  SPEC         — specification failures: the brief or AC was ambiguous,
                 contradictory, or missing required information.
  MODEL        — LLM failures: token budget exceeded, refusal, hallucinated
                 API, or structured-output decode error.
  UNKNOWN      — not classifiable; logged for learn_patterns.py review.

Usage::

    from datum.failure_layer import FailureLayer, tag_escalation

    layer = FailureLayer.from_reason("timeout_exceeded")
    event_payload = tag_escalation(escalated=True, reason="test_failure", layer=layer)
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any


class FailureLayer(StrEnum):
    """WHERE in the datum stack a failure originated.

    Designed to be stored alongside escalated=True / no_progress events so
    cross-run post-mortems can be filtered by layer.  String-valued so the
    enum serialises transparently in JSON payloads.
    """

    CONTEXT = "context"
    CONSTRAINT = "constraint"
    VERIFICATION = "verification"
    PLANNING = "planning"
    INFRASTRUCTURE = "infrastructure"
    SPEC = "spec"
    MODEL = "model"
    UNKNOWN = "unknown"

    # ── Mapping: diagnose_failure.py cause strings → layer ────────────────

    # Causes from diagnose_failure.py's _BUILTIN_HARD_STOP + _BUILTIN_ENVIRONMENTAL
    # + _BUILTIN_REASONING, plus agent_loop.py _finish() reason strings.
    _REASON_MAP: dict[str, FailureLayer]  # populated after class body

    @classmethod
    def from_reason(cls, reason: str | None) -> FailureLayer:
        """Map a diagnose_failure / agent_loop reason string to a FailureLayer.

        Falls back to UNKNOWN for unrecognised reasons.
        """
        if not reason:
            return cls.UNKNOWN
        normalised = reason.lower().strip()
        return cls._REASON_MAP.get(normalised, cls.UNKNOWN)

    @classmethod
    def from_classification(cls, classification: str | None) -> FailureLayer:
        """Coarse mapping from diagnose_failure classification → layer.

        Useful when only the broad classification (ENVIRONMENTAL / REASONING /
        HARD_STOP / UNKNOWN) is available, not the fine-grained cause.
        """
        if not classification:
            return cls.UNKNOWN
        _MAP = {
            "ENVIRONMENTAL": cls.INFRASTRUCTURE,
            "REASONING": cls.PLANNING,
            "HARD_STOP": cls.CONSTRAINT,
            "UNKNOWN": cls.UNKNOWN,
        }
        return _MAP.get(classification.upper(), cls.UNKNOWN)


# Populate the reason → layer map outside the class body so forward references
# resolve cleanly with Enum members.
FailureLayer._REASON_MAP = {
    # ── CONSTRAINT (guardrails, hooks, sandbox, budgets) ──────────────────
    "hook_blocked_write": FailureLayer.CONSTRAINT,
    "test_ratchet_violation": FailureLayer.CONSTRAINT,
    "lane_tool_sandbox_violation": FailureLayer.CONSTRAINT,
    "external_dependency_install": FailureLayer.CONSTRAINT,
    "budget_exhausted": FailureLayer.CONSTRAINT,
    "max_steps_exhausted": FailureLayer.CONSTRAINT,
    # ── INFRASTRUCTURE (disk, network, subprocess, env) ───────────────────
    "stale_path": FailureLayer.INFRASTRUCTURE,
    "stub_not_committed": FailureLayer.INFRASTRUCTURE,
    "lint_fixable": FailureLayer.INFRASTRUCTURE,
    "duplicate_commit": FailureLayer.INFRASTRUCTURE,
    "dirty_working_tree": FailureLayer.INFRASTRUCTURE,
    "merge_conflict_in_apply": FailureLayer.INFRASTRUCTURE,
    "patch_apply_failed": FailureLayer.INFRASTRUCTURE,
    "format_mismatch": FailureLayer.INFRASTRUCTURE,
    "subagent_timeout": FailureLayer.INFRASTRUCTURE,
    "timeout_exceeded": FailureLayer.INFRASTRUCTURE,
    # ── VERIFICATION (test / gate / AC rejection) ─────────────────────────
    "wrong_implementation": FailureLayer.VERIFICATION,
    "ac_gap": FailureLayer.VERIFICATION,
    "wrong_interpretation": FailureLayer.VERIFICATION,
    "test_failure": FailureLayer.VERIFICATION,
    "gate_failed": FailureLayer.VERIFICATION,
    # ── PLANNING (strategy, decomposition, loop detection) ────────────────
    "tool_discovery_failure": FailureLayer.PLANNING,
    "loop_detected": FailureLayer.PLANNING,
    "no_progress": FailureLayer.PLANNING,
    "orchestration_error": FailureLayer.PLANNING,
    # ── CONTEXT (retrieval, memory, stale context) ────────────────────────
    "stale_context": FailureLayer.CONTEXT,
    "retrieval_failure": FailureLayer.CONTEXT,
    "memory_miss": FailureLayer.CONTEXT,
    "context_window_exceeded": FailureLayer.CONTEXT,
    # ── MODEL (LLM decode, refusal, token budget) ─────────────────────────
    "structured_output_decode_error": FailureLayer.MODEL,
    "llm_refusal": FailureLayer.MODEL,
    "model_timeout": FailureLayer.MODEL,
    "token_budget_exceeded": FailureLayer.MODEL,
    # ── SPEC (brief / AC issues) ──────────────────────────────────────────
    "ambiguous_spec": FailureLayer.SPEC,
    "missing_ac": FailureLayer.SPEC,
    "contradictory_spec": FailureLayer.SPEC,
    # ── UNKNOWN ───────────────────────────────────────────────────────────
    "unrecognized_pattern": FailureLayer.UNKNOWN,
}


def tag_escalation(
    escalated: bool,
    reason: str | None,
    layer: FailureLayer | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a structured escalation payload suitable for events.py / transcripts.

    Parameters
    ----------
    escalated:
        True when the episode is being escalated; False for a clean finish.
    reason:
        The reason string from agent_loop._finish() or diagnose_failure.classify().
    layer:
        The FailureLayer, if already known.  Auto-derived from ``reason`` when
        *None* and ``escalated`` is True.
    extra:
        Additional key/value pairs to merge into the payload (e.g. step count).

    Returns a plain dict safe for JSON serialisation.
    """
    resolved_layer: FailureLayer | None
    if escalated:
        resolved_layer = (
            layer if layer is not None else FailureLayer.from_reason(reason)
        )
    else:
        resolved_layer = None

    payload: dict[str, Any] = {
        "escalated": escalated,
        "reason": reason,
        "failure_layer": resolved_layer.value if resolved_layer is not None else None,
    }
    if extra:
        payload.update(extra)
    return payload
