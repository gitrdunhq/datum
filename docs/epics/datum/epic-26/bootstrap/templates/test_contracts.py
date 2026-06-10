"""Contract tests for datum public API surfaces.

These tests run in datum-local to detect upstream datum API drift.
They fail loudly when function signatures or module structures change.

ISOL-003: No inference at import time — pure import and introspection only.
No model inference library imports, no remote inference endpoint calls.

When this suite fails, check the corresponding datum upstream surface:
  - test_state_*           → datum/state.py
  - test_gate_*            → datum/gate.py
  - test_local_llm_*       → datum/local_llm.py
  - test_pipeline_*        → datum/pipeline_scheduler.py
  - test_commit_queue_*    → datum/commit_queue.py
  - test_schemas_*         → datum/schemas.py

A failure means datum renamed, removed, or changed the signature of a public
symbol that datum-local depends on.  Fix: update datum-local's call sites to
match the new datum API, then re-run this suite to confirm green.
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
    """Catches drift: datum.state.load_state removed or replaced with a non-callable."""
    assert callable(load_state)


def test_state_load_state_signature():
    """Catches drift: load_state gained required parameters (breaking callers that pass none)."""
    sig = inspect.signature(load_state)
    params = list(sig.parameters.keys())
    assert params == [], f"load_state expected no params, got {params}"


def test_state_resolve_tier_is_callable():
    """Catches drift: datum.state.resolve_tier removed or replaced with a non-callable."""
    assert callable(resolve_tier)


def test_state_resolve_tier_signature():
    """Catches drift: resolve_tier lost 'phase' or 'run_state' params — M1 driver call sites break."""
    sig = inspect.signature(resolve_tier)
    params = list(sig.parameters.keys())
    assert "phase" in params, f"resolve_tier missing 'phase' param, got {params}"
    assert (
        "run_state" in params
    ), f"resolve_tier missing 'run_state' param, got {params}"


def test_state_phases_is_list():
    """Catches drift: PHASES changed from list to another collection type."""
    assert isinstance(PHASES, list), f"PHASES should be a list, got {type(PHASES)}"


def test_state_phases_has_expected_phases():
    """Catches drift: a phase was added, removed, or renamed in datum.state.PHASES."""
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
    """Catches drift: datum.gate module deleted or renamed."""
    assert datum.gate is not None


def test_gate_is_module():
    """Catches drift: datum.gate replaced with a non-module object (e.g. function or class)."""
    assert inspect.ismodule(datum.gate)


# ── datum.local_llm surfaces ──────────────────────────────────────────────────


def test_local_llm_run_phase_is_callable():
    """Catches drift: datum.local_llm.run_phase removed or replaced with a non-callable."""
    assert callable(run_phase)


def test_local_llm_run_phase_signature():
    """Catches drift: run_phase lost 'phase' or 'prompt' params — M1 driver invocations break."""
    sig = inspect.signature(run_phase)
    params = list(sig.parameters.keys())
    assert "phase" in params, f"run_phase missing 'phase', got {params}"
    assert "prompt" in params, f"run_phase missing 'prompt', got {params}"


def test_local_llm_multi_turn_phase_is_callable():
    """Catches drift: datum.local_llm.multi_turn_phase removed or replaced with a non-callable."""
    assert callable(multi_turn_phase)


def test_local_llm_multi_turn_phase_signature():
    """Catches drift: multi_turn_phase lost 'phase' or 'prompt' — the M1 driver loop breaks."""
    sig = inspect.signature(multi_turn_phase)
    params = list(sig.parameters.keys())
    assert "phase" in params, f"multi_turn_phase missing 'phase', got {params}"
    assert "prompt" in params, f"multi_turn_phase missing 'prompt', got {params}"


def test_local_llm_generate_is_callable():
    """Catches drift: datum.local_llm.generate removed or replaced with a non-callable."""
    assert callable(generate)


def test_local_llm_generate_signature():
    """Catches drift: generate lost 'model_id' or 'prompt' — direct inference call sites break."""
    sig = inspect.signature(generate)
    params = list(sig.parameters.keys())
    assert "model_id" in params, f"generate missing 'model_id', got {params}"
    assert "prompt" in params, f"generate missing 'prompt', got {params}"


def test_local_llm_structured_is_callable():
    """Catches drift: datum.local_llm.structured removed or replaced with a non-callable."""
    assert callable(structured)


def test_local_llm_structured_signature():
    """Catches drift: structured lost 'model_id', 'prompt', or 'schema' — schema-extraction breaks."""
    sig = inspect.signature(structured)
    params = list(sig.parameters.keys())
    assert "model_id" in params, f"structured missing 'model_id', got {params}"
    assert "prompt" in params, f"structured missing 'prompt', got {params}"
    assert "schema" in params, f"structured missing 'schema', got {params}"


def test_local_llm_execute_tool_is_callable():
    """Catches drift: datum.local_llm._execute_tool removed or replaced with a non-callable."""
    assert callable(_execute_tool)


def test_local_llm_execute_tool_signature():
    """Catches drift: _execute_tool lost 'tool_call' or 'mt_config' — write-tool dispatch breaks."""
    sig = inspect.signature(_execute_tool)
    params = list(sig.parameters.keys())
    assert "tool_call" in params, f"_execute_tool missing 'tool_call', got {params}"
    assert "mt_config" in params, f"_execute_tool missing 'mt_config', got {params}"


# ── datum.pipeline_scheduler surface ─────────────────────────────────────────


def test_pipeline_scheduler_importable():
    """Catches drift: datum.pipeline_scheduler module deleted or renamed."""
    assert datum.pipeline_scheduler is not None


def test_pipeline_scheduler_is_module():
    """Catches drift: datum.pipeline_scheduler replaced with a non-module object."""
    assert inspect.ismodule(datum.pipeline_scheduler)


# ── datum.commit_queue surface ────────────────────────────────────────────────


def test_commit_queue_importable():
    """Catches drift: datum.commit_queue module deleted or renamed."""
    assert datum.commit_queue is not None


def test_commit_queue_is_module():
    """Catches drift: datum.commit_queue replaced with a non-module object."""
    assert inspect.ismodule(datum.commit_queue)


def test_commit_queue_apply_patch_and_commit_is_callable():
    """Catches drift: apply_patch_and_commit removed — M1 driver commit step breaks."""
    assert callable(apply_patch_and_commit)


def test_commit_queue_apply_patch_and_commit_signature():
    """Catches drift: apply_patch_and_commit lost 'patch', 'message', 'run_id', or 'file_set'."""
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
    """Catches drift: datum.schemas.StepPlan deleted or renamed."""
    assert StepPlan is not None


def test_schemas_step_plan_fields():
    """Catches drift: StepPlan lost 'steps' or 'rationale' — planning turn output breaks."""
    fields = set(StepPlan.model_fields.keys())
    assert "steps" in fields, f"StepPlan missing 'steps', got {fields}"
    assert "rationale" in fields, f"StepPlan missing 'rationale', got {fields}"


def test_schemas_step_result_importable():
    """Catches drift: datum.schemas.StepResult deleted or renamed."""
    assert StepResult is not None


def test_schemas_step_result_fields():
    """Catches drift: StepResult lost any of its 9 fields — multi-turn loop parsing breaks."""
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
    """Catches drift: datum.schemas.ToolCall deleted or renamed."""
    assert ToolCall is not None


def test_schemas_tool_call_fields():
    """Catches drift: ToolCall lost 'tool_name' or 'tool_args' — _execute_tool dispatch breaks."""
    fields = set(ToolCall.model_fields.keys())
    assert "tool_name" in fields, f"ToolCall missing 'tool_name', got {fields}"
    assert "tool_args" in fields, f"ToolCall missing 'tool_args', got {fields}"


# ── inspect module usage ──────────────────────────────────────────────────────


def test_inspect_module_imported():
    """Sanity: confirms inspect stdlib is available — all signature tests depend on it."""
    assert inspect is not None
    assert inspect.ismodule(inspect)


def test_signature_introspection_works():
    """Sanity: inspect.signature() returns an inspect.Signature object for a known function."""
    sig = inspect.signature(load_state)
    assert isinstance(sig, inspect.Signature)


# ── Parametrized signature checks ────────────────────────────────────────────


@pytest.mark.parametrize("param_name", ["phase", "prompt"])
def test_run_phase_required_params(param_name):
    """Catches drift: run_phase renamed or dropped a required positional parameter."""
    sig = inspect.signature(run_phase)
    assert (
        param_name in sig.parameters
    ), f"run_phase missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["phase", "prompt"])
def test_multi_turn_phase_required_params(param_name):
    """Catches drift: multi_turn_phase renamed or dropped a required positional parameter."""
    sig = inspect.signature(multi_turn_phase)
    assert (
        param_name in sig.parameters
    ), f"multi_turn_phase missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["prompt", "model_id"])
def test_generate_required_params(param_name):
    """Catches drift: generate renamed or dropped a required positional parameter."""
    sig = inspect.signature(generate)
    assert (
        param_name in sig.parameters
    ), f"generate missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["prompt", "schema", "model_id"])
def test_structured_required_params(param_name):
    """Catches drift: structured renamed or dropped a required positional parameter."""
    sig = inspect.signature(structured)
    assert (
        param_name in sig.parameters
    ), f"structured missing required param '{param_name}'"


@pytest.mark.parametrize("param_name", ["tool_call", "mt_config"])
def test_execute_tool_required_params(param_name):
    """Catches drift: _execute_tool renamed or dropped a required positional parameter."""
    sig = inspect.signature(_execute_tool)
    assert (
        param_name in sig.parameters
    ), f"_execute_tool missing required param '{param_name}'"


@pytest.mark.parametrize("field_name", ["steps", "rationale"])
def test_step_plan_field_exists(field_name):
    """Catches drift: StepPlan Pydantic field renamed or removed."""
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
    """Catches drift: StepResult Pydantic field renamed or removed — multi-turn parsing breaks."""
    assert (
        field_name in StepResult.model_fields
    ), f"StepResult missing field '{field_name}'"


@pytest.mark.parametrize("field_name", ["tool_name", "tool_args"])
def test_tool_call_field_exists(field_name):
    """Catches drift: ToolCall Pydantic field renamed or removed — tool dispatch breaks."""
    assert field_name in ToolCall.model_fields, f"ToolCall missing field '{field_name}'"
