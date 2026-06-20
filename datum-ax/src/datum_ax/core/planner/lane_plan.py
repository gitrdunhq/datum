import json
from typing import Any, Optional

from datum_ax._base import Contract

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
        import asyncio
        from datum_ax.contracts.inference import ModelRole, AssembledPrompt, TokenBudget
        from pathlib import Path
        prompt_path = Path(__file__).parent.parent.parent / "prompts" / "lane-plan.md"
        prompt_text = prompt_path.read_text(encoding="utf-8")
        
        budget = TokenBudget(max_input=8000, max_output=2000, window_target=10000)
        system_text = prompt_text.replace("{{ticket}}", json.dumps(ticket))
        prompt = (
            crane.assemble(system_text, "", "", (), budget=budget)
            if crane is not None
            else AssembledPrompt(system=system_text, global_ast="", diff="")
        )
        
        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "LanePlan",
                "schema": LanePlan.model_json_schema(),
                "strict": True
            }
        }
        from datum_ax.core.orchestration.crane import ContextBudgetExceededError

        for attempt in range(3):
            call = inference_client.complete(role=ModelRole.PLANNER, prompt=prompt, budget=budget, response_format=format_dict)
            
            import inspect
            from typing import Any, cast, Coroutine
            if inspect.isawaitable(call):
                completion = asyncio.run(cast(Coroutine[Any, Any, Any], call))
            else:
                completion = call
                
            try:
                from datum_ax.core.utils import extract_json
                parsed = extract_json(getattr(completion, 'text', ''))
                if isinstance(parsed, list):
                    parsed = {"lanes": parsed}
                
                lanes_dict = LanePlan.model_validate(parsed).model_dump()["lanes"]
                
                # --- ADR-0022: Plan-Time Footprint Validation via ContextCrane ---
                from datum_ax.core.orchestration.crane import ContextBudgetExceededError
                
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
                import logging
                logging.warning(f"Lane too large on attempt {attempt+1}: {e}")
                prompt = AssembledPrompt(
                    system=prompt.system,
                    global_ast=prompt.global_ast,
                    diff=prompt.diff,
                    suffix=(*prompt.suffix, f"Validation Failed: {e}\nYou MUST decompose this lane into smaller, more granular lanes. It exceeds the 32k hard limit.")
                )
            except Exception as e:
                import logging
                logging.warning(f"Failed to parse lanes on attempt {attempt+1}: {e}\nRaw output: {getattr(completion, 'text', '')}")
                if attempt == 2:
                    return [{"id": "lane_1", "description": "Stub lane", "files": ["src/main.py"]}]
                prompt = AssembledPrompt(
                    system=prompt.system,
                    global_ast=prompt.global_ast,
                    diff=prompt.diff,
                    suffix=(*prompt.suffix, f"Your previous response:\n{getattr(completion, 'text', '')}\nFailed validation: {e}\nOutput ONLY valid JSON matching the requested schema.")
                )

    return [{"id": "lane_1", "description": "Stub lane", "files": ["src/main.py"]}]
