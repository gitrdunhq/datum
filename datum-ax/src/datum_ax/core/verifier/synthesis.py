import json
from typing import Any, Optional

from datum_ax._base import Contract

class SynthesisResult(Contract):
    diff: str

def synthesize_test(lane: dict[str, Any], inference_client: Optional[Any] = None) -> dict[str, Any]:
    """Stub implementation to synthesize a failing test (RED state)."""
    if inference_client:
        import asyncio
        from datum_ax.contracts.inference import ModelRole, AssembledPrompt, TokenBudget
        from pathlib import Path
        prompt_path = Path(__file__).parent.parent.parent / "prompts" / "red.md"
        prompt_text = prompt_path.read_text(encoding="utf-8")
        
        prompt = AssembledPrompt(
            system=prompt_text.replace("{{lane_json}}", json.dumps(lane)),
            global_ast="",
            diff=""
        )
        budget = TokenBudget(max_input=8000, max_output=1000, window_target=10000)
        
        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "SynthesisResult",
                "schema": SynthesisResult.model_json_schema(),
                "strict": True
            }
        }
        for attempt in range(3):
            call = inference_client.complete(role=ModelRole.EXECUTOR, prompt=prompt, budget=budget, response_format=format_dict)
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
                return SynthesisResult.model_validate(parsed).model_dump()
            except Exception as e:
                import logging
                logging.warning(f"Synthesis error on attempt {attempt+1}: {e}\nRaw output: {getattr(completion, 'text', '')}")
                if attempt == 2:
                    return {
                        "diff": f"--- /dev/null\n+++ b/tests/test_{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def test_{lane.get('id', 'new')}():\n+    pass\n"
                    }
                prompt = AssembledPrompt(
                    system=prompt.system,
                    global_ast=prompt.global_ast,
                    diff=prompt.diff,
                    suffix=(*prompt.suffix, f"Your previous response failed validation: {e}\nOutput exactly {{\"diff\": \"<unified diff>\"}}.")
                )

    return {
        "diff": f"--- /dev/null\n+++ b/tests/test_{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def test_{lane.get('id', 'new')}():\n+    pass\n"
    }

def synthesize_impl(lane: dict[str, Any], inference_client: Optional[Any] = None) -> dict[str, Any]:
    """Stub implementation to synthesize the implementation code (GREEN state)."""
    if inference_client:
        import asyncio
        from datum_ax.contracts.inference import ModelRole, AssembledPrompt, TokenBudget
        from pathlib import Path
        prompt_path = Path(__file__).parent.parent.parent / "prompts" / "green.md"
        prompt_text = prompt_path.read_text(encoding="utf-8")
        
        prompt = AssembledPrompt(
            system=prompt_text.replace("{{lane_json}}", json.dumps(lane)),
            global_ast="",
            diff=""
        )
        budget = TokenBudget(max_input=8000, max_output=2000, window_target=10000)
        
        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "SynthesisResult",
                "schema": SynthesisResult.model_json_schema(),
                "strict": True
            }
        }
        for attempt in range(3):
            call = inference_client.complete(role=ModelRole.EXECUTOR, prompt=prompt, budget=budget, response_format=format_dict)
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
                return SynthesisResult.model_validate(parsed).model_dump()
            except Exception as e:
                import logging
                logging.warning(f"Synthesis error on attempt {attempt+1}: {e}\nRaw output: {getattr(completion, 'text', '')}")
                if attempt == 2:
                    return {
                        "diff": f"--- /dev/null\n+++ b/src/{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def {lane.get('id', 'new')}():\n+    pass\n"
                    }
                prompt = AssembledPrompt(
                    system=prompt.system,
                    global_ast=prompt.global_ast,
                    diff=prompt.diff,
                    suffix=(*prompt.suffix, f"Your previous response failed validation: {e}\nOutput exactly {{\"diff\": \"<unified diff>\"}}.")
                )

    return {
        "diff": f"--- /dev/null\n+++ b/src/{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def {lane.get('id', 'new')}():\n+    pass\n"
    }
