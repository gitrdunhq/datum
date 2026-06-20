import json
from typing import Any, Optional


from datum_ax._base import Contract

class TriageDecision(Contract):
    route: str
    target: str

def triage_ticket(
    ticket: dict[str, Any],
    inference_client: Optional[Any] = None,
    crane: Optional[Any] = None,
) -> dict[str, Any]:
    """Deterministically routes tickets to execution targets and pipeline routes."""
    if inference_client:
        import asyncio
        from datum_ax.contracts.inference import ModelRole, AssembledPrompt, TokenBudget
        
        from pathlib import Path
        prompt_path = Path(__file__).parent.parent.parent / "prompts" / "triage.md"
        prompt_text = prompt_path.read_text(encoding="utf-8")
        
        budget = TokenBudget(max_input=8000, max_output=1000, window_target=10000)
        system_text = prompt_text.replace("{{input}}", json.dumps(ticket))
        # ContextCrane is the single assembler (ADR-0030); fall back to a bare prompt only when
        # called without one (unit tests).
        def _assemble(system: str, global_ast: str, diff: str, suffix: tuple[str, ...]) -> AssembledPrompt:
            if crane is not None:
                return crane.assemble(system, global_ast, diff, suffix, budget=budget)
            return AssembledPrompt(system=system, global_ast=global_ast, diff=diff, suffix=suffix)

        prompt = _assemble(system_text, "", "", ())
        
        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "TriageDecision",
                "schema": TriageDecision.model_json_schema(),
                "strict": True
            }
        }
        for attempt in range(3):
            call = inference_client.complete(role=ModelRole.TRIAGE, prompt=prompt, budget=budget, response_format=format_dict)
            
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
                    parsed = parsed[0] if parsed else {}
                return TriageDecision.model_validate(parsed).model_dump()
            except Exception as e:
                import logging
                logging.warning(f"Failed to parse triage on attempt {attempt+1}: {e}\nRaw output: {getattr(completion, 'text', '')}")
                if attempt == 2:
                    break
                prompt = _assemble(
                    prompt.system, prompt.global_ast, prompt.diff,
                    (*prompt.suffix, f"Your previous response:\n{getattr(completion, 'text', '')}\nFailed validation: {e}\nOutput EXACTLY the requested JSON schema."),
                )

    scale = ticket.get("scale", "task").lower()
    
    route = "feature"
    if scale == "patch":
        route = "patch"
    elif scale == "epic":
        route = "system"
        
    return {
        "route": route,
        "target": "x86",  # Standard x86 linux docker target for most general tasks
    }
