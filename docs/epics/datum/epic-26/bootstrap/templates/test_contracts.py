"""Contract tests for datum public API surfaces.

These tests run in datum-local to detect upstream datum API drift.
They fail loudly when function signatures or module structures change.

ISOL-003: No inference at import time — pure import and introspection only.
No model inference library imports, no remote inference endpoint calls.
"""

from __future__ import annotations

import inspect

import pytest

# ── Imports ──────────────────────────────────────────────────────────────────

import datum.state
from datum.state import load_state, resolve_tier, PHASES

import datum.gate

import datum.local_llm
from datum.local_llm import (
    run_phase,
    multi_turn_phase,
    generate,
    structured,
    _execute_tool,
)

import datum.pipeline_scheduler
import datum.commit_queue
from datum.commit_queue import apply_patch_and_commit

from datum.schemas import StepPlan, StepResult, ToolCall

# ── datum.state surface ───────────────────────────────────────────────────────


def test_state_load_state_is_callable():
    assert callable(load_state)


def test_state_load_state_signature():
    sig = inspect.signature(load_state)
    params = list(sig.parameters.keys())
    assert params == [], f"load_state expected no params, got {params}"


def test_state_resolve_tier_is_callable():
    assert callable(resolve_tier)


def test_state_resolve_tier_signature():
    sig = inspect.signature(resolve_tier)
    params = list(sig.parameters.keys())
    assert "phase" in params, f"resolve_tier missing 'phase' param, got {params}"
    assert (
        "run_state" in params
    ), f"resolve_tier missing 'run_state' param, got {params}"


def test_state_phases_is_list():
    assert isinstance(PHASES, list), f"PHASES should be a list, got {type(PHASES)}"


def test_state_phases_has_expected_phases():
    expected = [
        "discovery",
        "refine",
        "plan",
        "triage",
        "deepen",
        "properties",
        "act",
        "validate",
        "review",
        "pr_comments",
        "closeout",
    ]
    assert PHASES == expected, f"PHASES mismatch: {PHASES}"


# ── datum.gate surface ────────────────────────────────────────────────────────


def test_gate_module_importable():
    assert datum.gate is not None


def test_gate_is_module():
    assert inspect.ismodule(datum.gate)


# ── datum.local_llm surfaces ──────────────────────────────────────────────────


def test_local_llm_run_phase_is_callable():
    assert callable(run_phase)


def test_local_llm_run_phase_signature():
    sig = inspect.signature(run_phase)
    params = list(sig.parameters.keys())
    assert "phase" in params, f"run_phase missing 'phase', got {params}"
    assert "prompt" in params, f"run_phase missing 'prompt', got {params}"


def test_local_llm_multi_turn_phase_is_callable():
    assert callable(multi_turn_phase)


def test_local_llm_multi_turn_phase_signature():
    sig = inspect.signature(multi_turn_phase)
    params = list(sig.parameters.keys())
    assert "phase" in params, f"multi_turn_phase missing 'phase', got {params}"
    assert "prompt" in params, f"multi_turn_phase missing 'prompt', got {params}"


def test_local_llm_generate_is_callable():
    assert callable(generate)


def test_local_llm_generate_signature():
    sig = inspect.signature(generate)
    params = list(sig.parameters.keys())
    assert "model_id" in params, f"generate missing 'model_id', got {params}"
    assert "prompt" in params, f"generate missing 'prompt', got {params}"


def test_local_llm_structured_is_callable():
    assert callable(structured)


def test_local_llm_structured_signature():
    sig = inspect.signature(structured)
    params = list(sig.parameters.keys())
    assert "model_id" in params, f"structured missing 'model_id', got {params}"
    assert "prompt" in params, f"structured missing 'prompt', got {params}"
    assert "schema" in params, f"structured missing 'schema', got {params}"


def test_local_llm_execute_tool_is_callable():
    assert callable(_execute_tool)


def test_local_llm_execute_tool_signature():
    sig = inspect.signature(_execute_tool)
    params = list(sig.parameters.keys())
    assert "tool_call" in params, f"_execute_tool missing 'tool_call', got {params}"
    assert "mt_config" in params, f"_execute_tool missing 'mt_config', got {params}"


# ── datum.pipeline_scheduler surface ─────────────────────────────────────────


def test_pipeline_scheduler_importable():
    assert datum.pipeline_scheduler is not None


def test_pipeline_scheduler_is_module():
    assert inspect.ismodule(datum.pipeline_scheduler)


# ── datum.commit_queue surface ────────────────────────────────────────────────


def test_commit_queue_importable():
    assert datum.commit_queue is not None


def test_commit_queue_is_module():
    assert inspect.ismodule(datum.commit_queue)


def test_commit_queue_apply_patch_and_commit_is_callable():
    assert callable(apply_patch_and_commit)


def test_commit_queue_apply_patch_and_commit_signature():
    sig = inspect.signature(apply_patch_and_commit)
    params = list(sig.parameters.keys())
    assert "patch" in params, f"apply_patch_and_commit missing 'patch', got {params}"
    assert (
        "message" in params
    ), f"apply_patch_and_commit missing 'message', got {params}"
    assert "run_id" in params, f"apply_patch_and_commit missing 'run_id', got {params}"
    assert (
        "file_set" in params
    ), f"apply_patch_and_commit missing 'file_set', got {params}"


# ── datum.schemas surface ─────────────────────────────────────────────────────


def test_schemas_step_plan_importable():
    assert StepPlan is not None


def test_schemas_step_plan_fields():
    fields = set(StepPlan.model_fields.keys())
    assert "steps" in fields, f"StepPlan missing 'steps', got {fields}"
    assert "rationale" in fields, f"StepPlan missing 'rationale', got {fields}"


def test_schemas_step_result_importable():
    assert StepResult is not None


def test_schemas_step_result_fields():
    fields = set(StepResult.model_fields.keys())
    expected = {
        "step_index",
        "action",
        "finding",
        "evidence",
        "recommendation",
        "confidence",
        "needs_more_turns",
        "escalate",
        "tool_call",
    }
    for field in expected:
        assert field in fields, f"StepResult missing '{field}', got {fields}"


def test_schemas_tool_call_importable():
    assert ToolCall is not None


def test_schemas_tool_call_fields():
    fields = set(ToolCall.model_fields.keys())
    assert "tool_name" in fields, f"ToolCall missing 'tool_name', got {fields}"
    assert "tool_args" in fields, f"ToolCall missing 'tool_args', got {fields}"


# ── inspect module usage ──────────────────────────────────────────────────────


def test_inspect_module_imported():
    assert inspect is not None
    assert inspect.ismodule(inspect)


def test_signature_introspection_works():
    sig = inspect.signature(load_state)
    assert isinstance(sig, inspect.Signature)


# ── Parametrized signature checks ────────────────────────────────────────────


@pytest.mark.parametrize("param_name", ["phase", "prompt"])
def test_run_phase_required_params(param_name):
    sig = inspect.signature(run_phase)
    assert (
        param_name in sig.parameters
    ), f"run_phase missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["phase", "prompt"])
def test_multi_turn_phase_required_params(param_name):
    sig = inspect.signature(multi_turn_phase)
    assert (
        param_name in sig.parameters
    ), f"multi_turn_phase missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["prompt", "model_id"])
def test_generate_required_params(param_name):
    sig = inspect.signature(generate)
    assert (
        param_name in sig.parameters
    ), f"generate missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["prompt", "schema", "model_id"])
def test_structured_required_params(param_name):
    sig = inspect.signature(structured)
    assert (
        param_name in sig.parameters
    ), f"structured missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["tool_call", "mt_config"])
def test_execute_tool_required_params(param_name):
    sig = inspect.signature(_execute_tool)
    assert (
        param_name in sig.parameters
    ), f"_execute_tool missing required param '{param_name}'"


@pytest.mark.parametrize("field_name", ["steps", "rationale"])
def test_step_plan_field_exists(field_name):
    assert field_name in StepPlan.model_fields, f"StepPlan missing field '{field_name}'"


@pytest.mark.parametrize(
    "field_name",
    [
        "step_index",
        "action",
        "finding",
        "evidence",
        "recommendation",
        "confidence",
        "needs_more_turns",
        "escalate",
        "tool_call",
    ],
)
def test_step_result_field_exists(field_name):
    assert (
        field_name in StepResult.model_fields
    ), f"StepResult missing field '{field_name}'"


@pytest.mark.parametrize("field_name", ["tool_name", "tool_args"])
def test_tool_call_field_exists(field_name):
    assert field_name in ToolCall.model_fields, f"ToolCall missing field '{field_name}'"
