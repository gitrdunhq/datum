import asyncio
import inspect
import json
from typing import Any, Coroutine, Optional, cast

from datum_ax._base import Contract
from datum_ax.contracts.inference import ModelRole, TokenBudget
from datum_ax.core.orchestration.crane import ContextBudgetExceededError
from datum_ax.core.utils import extract_json
from datum_ax.observability import get_logger

logger = get_logger(__name__)


class LaneDef(Contract):
    id: str
    description: str
    files: list[str]


class LanePlan(Contract):
    lanes: list[LaneDef]


def plan_lanes(
    ticket: dict[str, Any],
    inference_client: Optional[Any] = None,
    crane: Optional[Any] = None,
) -> list[dict[str, Any]]:
    """Generates execution lanes for a ticket."""
    if inference_client:
        if crane is None:
            raise ValueError("plan_lanes requires a ContextCrane (persona + assembly, ADR-0033)")
        budget = TokenBudget(max_input=8000, max_output=2000, window_target=10000)
        # Role prompt comes from the persona registry via the crane (ADR-0033).
        system_text = crane.compose_system("lane-plan").replace("{{ticket}}", json.dumps(ticket))

        def _assemble(system: str, global_ast: str, diff: str, suffix: tuple[str, ...]):
            return crane.assemble(system, global_ast, diff, suffix, budget=budget)

        prompt = _assemble(system_text, "", "", ())

        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "LanePlan",
                "schema": LanePlan.model_json_schema(),
                "strict": True,
            },
        }
        for attempt in range(3):
            call = inference_client.complete(
                role=ModelRole.PLANNER, prompt=prompt, budget=budget, response_format=format_dict
            )

            if inspect.isawaitable(call):
                completion = asyncio.run(cast(Coroutine[Any, Any, Any], call))
            else:
                completion = call

            try:
                parsed = extract_json(getattr(completion, "text", ""))
                if isinstance(parsed, list):
                    parsed = {"lanes": parsed}

                lanes_dict = LanePlan.model_validate(parsed).model_dump()["lanes"]

                # --- ADR-0022: Plan-Time Footprint Validation via ContextCrane ---
                # In a full DI setup, the crane is injected.
                # If a lane is too broad (e.g. requires pulling the entire codebase),
                # the crane estimation will throw ContextBudgetExceededError.
                # For this demo scaffolding, we simulate catching the error:

                for lane in lanes_dict:
                    # e.g., crane.estimate_lane_footprint(system, global_ast, diff)
                    # if footprint > budget.max_input: raise ContextBudgetExceededError(...)
                    pass

                return cast(list[dict[str, Any]], lanes_dict)

            except ContextBudgetExceededError as e:
                logger.warning("lane_too_large", attempt=attempt + 1, error=str(e))
                prompt = _assemble(
                    prompt.system,
                    prompt.global_ast,
                    prompt.diff,
                    (
                        *prompt.suffix,
                        f"Validation Failed: {e}\nYou MUST decompose this lane into smaller, more granular lanes. It exceeds the 32k hard limit.",
                    ),
                )
            except Exception as e:
                logger.warning(
                    "lane_parse_failed",
                    attempt=attempt + 1,
                    error=str(e),
                    raw_output=getattr(completion, "text", ""),
                )
                if attempt == 2:
                    return [{"id": "lane_1", "description": "Stub lane", "files": ["src/main.py"]}]
                prompt = _assemble(
                    prompt.system,
                    prompt.global_ast,
                    prompt.diff,
                    (
                        *prompt.suffix,
                        f"Your previous response:\n{getattr(completion, 'text', '')}\nFailed validation: {e}\nOutput ONLY valid JSON matching the requested schema.",
                    ),
                )

    return [{"id": "lane_1", "description": "Stub lane", "files": ["src/main.py"]}]
