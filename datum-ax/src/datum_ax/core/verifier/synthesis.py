import asyncio
import inspect
import json
from typing import Any, Coroutine, Optional, cast

from datum_ax._base import Contract
from datum_ax.contracts.inference import ModelRole, TokenBudget
from datum_ax.core.utils import extract_json
from datum_ax.observability import get_logger

logger = get_logger(__name__)

_FORMAT: dict[str, Any] = {
    "type": "json_schema",
    "json_schema": {
        "name": "SynthesisResult",
        "schema": None,  # filled at import below
        "strict": True,
    },
}


class SynthesisResult(Contract):
    diff: str


_FORMAT["json_schema"]["schema"] = SynthesisResult.model_json_schema()


def _synthesize(
    lane: dict[str, Any],
    inference_client: Optional[Any],
    crane: Optional[Any],
    *,
    role: str,
    max_output: int,
    stub_diff: str,
) -> dict[str, Any]:
    """Shared RED/GREEN synthesis (ADR-0007). Returns ``{"diff", "attempts"}``; ``attempts`` is how
    many model attempts were spent (the ledger reads it to learn from retried failures). Falls back to
    the stub diff on parse-exhaustion OR a context-budget overflow — never escapes as an exception."""
    # Imported lazily: ``orchestration.crane`` lives in the orchestration package whose ``__init__``
    # eagerly imports ``graph`` (which imports this module) — a function-local import sidesteps the
    # import cycle when ``synthesis`` is loaded first (e.g. directly by a test).
    from datum_ax.core.orchestration.crane import ContextBudgetExceededError

    if not inference_client:
        return {"diff": stub_diff, "attempts": 0}
    if crane is None:
        raise ValueError("synthesize requires a ContextCrane (persona + assembly, ADR-0033)")

    budget = TokenBudget(max_input=8000, max_output=max_output, window_target=10000)
    lifted_trouble = False
    try:
        system_text = crane.compose_system(role, scope_tags=("code",)).replace(
            "{{lane_json}}", json.dumps(lane)
        )
        prompt = crane.assemble(system_text, "", "", (), budget=budget)
        for attempt in range(3):
            call = inference_client.complete(
                role=ModelRole.EXECUTOR, prompt=prompt, budget=budget, response_format=_FORMAT
            )
            completion = (
                asyncio.run(cast(Coroutine[Any, Any, Any], call))
                if inspect.isawaitable(call)
                else call
            )
            try:
                parsed = extract_json(getattr(completion, "text", ""))
                if isinstance(parsed, list):
                    parsed = parsed[0] if parsed else {}
                out = SynthesisResult.model_validate(parsed).model_dump()
                out["attempts"] = attempt + 1
                return out
            except Exception as e:
                logger.warning(
                    "synthesis_failed",
                    role=role,
                    attempt=attempt + 1,
                    error=str(e),
                    raw_output=getattr(completion, "text", ""),
                )
                if attempt == 2:
                    return {"diff": stub_diff, "attempts": 3}
                retry_suffix = (
                    *prompt.suffix,
                    f'Your previous response failed validation: {e}\nOutput exactly {{"diff": "<unified diff>"}}.',
                )
                # A failed attempt is a troubleshooting task: lift the focused gitnexus debugging skill
                # into the VARIABLE slot ONCE (tracked by a flag, not by scanning the suffix — DCP
                # pruning can erase the "## Skill:" marker), keeping the prefix cache-stable (ADR-0033).
                trouble = crane.lift_skills(("debug",))
                if trouble and not lifted_trouble:
                    retry_suffix = (*retry_suffix, trouble)
                    lifted_trouble = True
                prompt = crane.assemble(
                    prompt.system, prompt.global_ast, prompt.diff, retry_suffix, budget=budget
                )
    except ContextBudgetExceededError as e:
        # The essential prefix doesn't fit — a planning defect (ADR-0022). Degrade gracefully instead
        # of escaping the node; the planner should decompose the lane (review #2).
        logger.warning("synthesis_budget_exceeded", role=role, error=str(e))
        return {"diff": stub_diff, "attempts": 0}
    return {"diff": stub_diff, "attempts": 0}


def synthesize_test(
    lane: dict[str, Any],
    inference_client: Optional[Any] = None,
    crane: Optional[Any] = None,
) -> dict[str, Any]:
    """Synthesize a failing test (RED state)."""
    lane_id = lane.get("id", "new")
    stub = f"--- /dev/null\n+++ b/tests/test_{lane_id}.py\n@@ -0,0 +1,2 @@\n+def test_{lane_id}():\n+    pass\n"
    return _synthesize(lane, inference_client, crane, role="red", max_output=1000, stub_diff=stub)


def synthesize_impl(
    lane: dict[str, Any],
    inference_client: Optional[Any] = None,
    crane: Optional[Any] = None,
) -> dict[str, Any]:
    """Synthesize the implementation code (GREEN state)."""
    lane_id = lane.get("id", "new")
    stub = f"--- /dev/null\n+++ b/src/{lane_id}.py\n@@ -0,0 +1,2 @@\n+def {lane_id}():\n+    pass\n"
    return _synthesize(lane, inference_client, crane, role="green", max_output=2000, stub_diff=stub)
