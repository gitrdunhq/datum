"""RED tests for task-005: contract-test suite template.

Validates the template file at:
  docs/epics/datum/epic-26/bootstrap/templates/test_contracts.py

Three layers of verification:
1. Template file exists.
2. Static content checks — required imports and inspect.signature usage present.
3. Executable check — run the template via `uv run pytest` in this repo;
   datum is importable here, so a correct contract suite must exit 0 and
   collect >= N tests.

Properties covered: LIVE-002, IDEM-004, ISOL-003, COMPAT-004, COMPAT-005
"""

import ast
import re
import subprocess
from pathlib import Path

TEMPLATE_PATH = Path("docs/epics/datum/epic-26/bootstrap/templates/test_contracts.py")
REPO_ROOT = Path(__file__).resolve().parent.parent

# Absolute path used for subprocess calls
TEMPLATE_ABS = REPO_ROOT / TEMPLATE_PATH


# ---------------------------------------------------------------------------
# Layer 1: existence
# ---------------------------------------------------------------------------


def test_template_file_exists():
    """Template must exist before GREEN can pass any downstream test."""
    assert TEMPLATE_ABS.exists(), (
        f"Template not found at {TEMPLATE_ABS}. "
        "GREEN: create docs/epics/datum/epic-26/bootstrap/templates/test_contracts.py"
    )


# ---------------------------------------------------------------------------
# Helper — read template source once (used by all content tests)
# ---------------------------------------------------------------------------


def _template_source() -> str:
    if not TEMPLATE_ABS.exists():
        raise FileNotFoundError(
            f"Template missing at {TEMPLATE_ABS} — run Layer 1 test first."
        )
    return TEMPLATE_ABS.read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# Layer 2a: required import surfaces — AC3.1 / COMPAT-004
# ---------------------------------------------------------------------------


def test_imports_state_load_state():
    """AC3.1: template imports datum.state.load_state."""
    src = _template_source()
    assert "load_state" in src, "Template must import datum.state.load_state"


def test_imports_state_resolve_tier():
    """AC3.1: template imports datum.state.resolve_tier."""
    src = _template_source()
    assert "resolve_tier" in src, "Template must import datum.state.resolve_tier"


def test_imports_state_phases():
    """AC3.1: template imports datum.state.PHASES."""
    src = _template_source()
    assert "PHASES" in src, "Template must import/reference datum.state.PHASES"


def test_imports_datum_gate():
    """AC3.2: template imports datum.gate module."""
    src = _template_source()
    assert re.search(
        r"\bdatum\.gate\b|from datum import gate|from datum\.gate", src
    ), "Template must import datum.gate"


def test_imports_local_llm_run_phase():
    """AC3.3: template imports datum.local_llm.run_phase."""
    src = _template_source()
    assert "run_phase" in src, "Template must import datum.local_llm.run_phase"


def test_imports_local_llm_multi_turn_phase():
    """AC3.3: template imports datum.local_llm.multi_turn_phase."""
    src = _template_source()
    assert (
        "multi_turn_phase" in src
    ), "Template must import datum.local_llm.multi_turn_phase"


def test_imports_local_llm_generate():
    """AC3.3: template imports datum.local_llm.generate."""
    src = _template_source()
    assert "generate" in src, "Template must import datum.local_llm.generate"


def test_imports_local_llm_structured():
    """AC3.3: template imports datum.local_llm.structured."""
    src = _template_source()
    assert "structured" in src, "Template must import datum.local_llm.structured"


def test_imports_local_llm_execute_tool():
    """AC3.3: template imports datum.local_llm._execute_tool."""
    src = _template_source()
    assert "_execute_tool" in src, "Template must import datum.local_llm._execute_tool"


def test_imports_pipeline_scheduler():
    """AC3.4: template imports datum.pipeline_scheduler."""
    src = _template_source()
    assert re.search(
        r"pipeline_scheduler", src
    ), "Template must import datum.pipeline_scheduler"


def test_imports_commit_queue():
    """AC3.4: template imports datum.commit_queue."""
    src = _template_source()
    assert re.search(r"commit_queue", src), "Template must import datum.commit_queue"


def test_imports_schemas_step_plan():
    """AC3.5: template imports datum.schemas.StepPlan."""
    src = _template_source()
    assert "StepPlan" in src, "Template must import datum.schemas.StepPlan"


def test_imports_schemas_step_result():
    """AC3.5: template imports datum.schemas.StepResult."""
    src = _template_source()
    assert "StepResult" in src, "Template must import datum.schemas.StepResult"


def test_imports_schemas_tool_call():
    """AC3.5: template imports datum.schemas.ToolCall."""
    src = _template_source()
    assert "ToolCall" in src, "Template must import datum.schemas.ToolCall"


# ---------------------------------------------------------------------------
# Layer 2b: inspect.signature usage — AC3.6 / COMPAT-004
# ---------------------------------------------------------------------------


def test_uses_inspect_signature():
    """AC3.6 / COMPAT-004: template must use inspect.signature() for validation."""
    src = _template_source()
    assert (
        "inspect.signature" in src or "from inspect import signature" in src
    ), "Template must use inspect.signature() to assert parameter names/counts"


def test_imports_inspect_module():
    """Template must import the inspect stdlib module."""
    src = _template_source()
    assert re.search(
        r"\bimport inspect\b|from inspect import", src
    ), "Template must import the inspect module"


# ---------------------------------------------------------------------------
# Layer 2c: signature content checks — exact parameter names
# ---------------------------------------------------------------------------


def test_asserts_load_state_signature():
    """load_state() takes no parameters — template must assert empty params."""
    src = _template_source()
    # The template should call inspect.signature on load_state and check params
    assert "load_state" in src, "Template must reference load_state for signature check"
    # Verify the assertion is present (not just import)
    assert re.search(
        r"load_state.*sign|sign.*load_state", src, re.DOTALL
    ), "Template must perform a signature assertion on load_state"


def test_asserts_resolve_tier_signature():
    """resolve_tier(phase, run_state=None) — template must check param names."""
    src = _template_source()
    assert "resolve_tier" in src
    # Parameter names from TASKS.md Research Findings
    assert "phase" in src, "Template must reference 'phase' param in resolve_tier check"


def test_asserts_run_phase_signature():
    """run_phase(phase, prompt, schema, max_tokens, mt_overrides) — 5 params."""
    src = _template_source()
    assert "run_phase" in src
    assert "prompt" in src, "Template must reference 'prompt' param in run_phase check"


def test_asserts_multi_turn_phase_signature():
    """multi_turn_phase has identical signature shape to run_phase."""
    src = _template_source()
    assert "multi_turn_phase" in src


def test_asserts_generate_signature():
    """generate(prompt, model_id, max_tokens, temperature) — 4 params."""
    src = _template_source()
    assert "generate" in src
    assert (
        "model_id" in src
    ), "Template must reference 'model_id' param in generate check"


def test_asserts_execute_tool_signature():
    """_execute_tool(tool_call, mt_config) → tuple[str, bool]."""
    src = _template_source()
    assert "_execute_tool" in src
    assert "tool_call" in src, "Template must reference 'tool_call' param"
    assert "mt_config" in src, "Template must reference 'mt_config' param"


def test_asserts_apply_patch_and_commit_signature():
    """commit_queue.apply_patch_and_commit(patch, message, run_id, file_set)."""
    src = _template_source()
    # Either the function name or module must appear
    assert "apply_patch_and_commit" in src or "commit_queue" in src


# ---------------------------------------------------------------------------
# Layer 2d: schema field checks — AC3.5
# ---------------------------------------------------------------------------


def test_step_plan_fields_checked():
    """StepPlan has fields: steps, rationale — template must reference them."""
    src = _template_source()
    assert "StepPlan" in src
    # At least one field name must appear nearby
    assert (
        "steps" in src or "rationale" in src
    ), "Template must check StepPlan fields (steps / rationale)"


def test_step_result_fields_checked():
    """StepResult has 9 fields — template must reference key ones."""
    src = _template_source()
    assert "StepResult" in src
    checked_fields = [
        f
        for f in [
            "step_index",
            "action",
            "finding",
            "evidence",
            "recommendation",
            "confidence",
            "needs_more_turns",
            "escalate",
            "tool_call",
        ]
        if f in src
    ]
    assert (
        len(checked_fields) >= 3
    ), f"Template must reference at least 3 StepResult fields; found: {checked_fields}"


def test_tool_call_fields_checked():
    """ToolCall has fields: tool_name, tool_args — template must reference them."""
    src = _template_source()
    assert "ToolCall" in src
    assert (
        "tool_name" in src or "tool_args" in src
    ), "Template must check ToolCall fields (tool_name / tool_args)"


# ---------------------------------------------------------------------------
# Layer 2e: ISOL-003 — no oMLX / model dependency
# ---------------------------------------------------------------------------


def test_no_omlx_dependency():
    """ISOL-003: contract tests must not depend on a running oMLX server."""
    src = _template_source()
    # Should not start the server or import mlx_lm at module level
    assert "localhost:12200" not in src, (
        "ISOL-003: template must not hardcode the oMLX endpoint — "
        "contract tests are import/signature only"
    )
    assert (
        "_omlx_available()" not in src
    ), "ISOL-003: template must not call _omlx_available() — no model needed"


def test_no_mlx_lm_import():
    """ISOL-003: contract tests must not import mlx_lm."""
    src = _template_source()
    assert (
        "mlx_lm" not in src
    ), "ISOL-003: template must not import mlx_lm — contract tests need no model"


# ---------------------------------------------------------------------------
# Layer 2f: template is syntactically valid Python
# ---------------------------------------------------------------------------


def test_template_is_valid_python():
    """Template must parse as valid Python (ast.parse)."""
    src = _template_source()
    try:
        ast.parse(src)
    except SyntaxError as exc:
        raise AssertionError(f"Template has syntax errors: {exc}") from exc


def test_template_contains_test_functions():
    """Template must define at least one pytest-style test_ function."""
    src = _template_source()
    matches = re.findall(r"^def test_\w+", src, re.MULTILINE)
    assert (
        len(matches) >= 5
    ), f"Template must define >= 5 test functions; found {len(matches)}: {matches}"


# ---------------------------------------------------------------------------
# Layer 3: executable check — run template with uv run pytest in this repo
# ---------------------------------------------------------------------------


def test_template_runs_and_passes_in_datum_repo():
    """AC3.7 / IDEM-004: uv run pytest <template> passes green (datum importable here).

    Asserts:
    - exit code 0
    - >= 5 tests collected and passing
    The template is designed for datum-local, but since datum is importable in
    THIS repo too, a correct contract suite must pass here as well.
    """
    if not TEMPLATE_ABS.exists():
        raise FileNotFoundError(
            f"Template not found at {TEMPLATE_ABS}. Cannot run executable check."
        )

    result = subprocess.run(
        ["uv", "run", "pytest", str(TEMPLATE_ABS), "-q", "--tb=short"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=120,
    )

    output = result.stdout + result.stderr

    assert result.returncode == 0, (
        f"Template pytest run failed (exit {result.returncode}).\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )

    # Parse collected/passed count from pytest -q output
    # e.g. "13 passed in 0.45s" or "5 passed, 2 warnings in 1.2s"
    passed_match = re.search(r"(\d+) passed", output)
    assert (
        passed_match is not None
    ), f"Could not find passed count in pytest output:\n{output}"
    passed_count = int(passed_match.group(1))
    assert passed_count >= 5, (
        f"Template collected only {passed_count} passing tests; expected >= 5.\n"
        f"Output:\n{output}"
    )


def test_template_collects_minimum_tests():
    """Verify template collects >= 10 tests (comprehensive coverage check)."""
    if not TEMPLATE_ABS.exists():
        raise FileNotFoundError(f"Template not found at {TEMPLATE_ABS}.")

    result = subprocess.run(
        ["uv", "run", "pytest", str(TEMPLATE_ABS), "--collect-only", "-q"],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        timeout=60,
    )

    output = result.stdout + result.stderr

    # Count "<module>::test_xxx" lines
    collected = re.findall(r"test_contracts\.py::test_\w+", output)
    assert len(collected) >= 10, (
        f"Template only collected {len(collected)} tests; expected >= 10.\n"
        f"Output:\n{output}"
    )


def test_template_second_run_same_result():
    """IDEM-004: running the template twice gives the same exit code (idempotent)."""
    if not TEMPLATE_ABS.exists():
        raise FileNotFoundError(f"Template not found at {TEMPLATE_ABS}.")

    def _run():
        return subprocess.run(
            ["uv", "run", "pytest", str(TEMPLATE_ABS), "-q", "--tb=line"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=120,
        ).returncode

    rc1 = _run()
    rc2 = _run()
    assert (
        rc1 == rc2
    ), f"IDEM-004: first run returned {rc1}, second run returned {rc2} — not idempotent"
    assert rc1 == 0, f"Template must exit 0 on both runs, got {rc1}"
