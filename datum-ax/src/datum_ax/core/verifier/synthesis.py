import asyncio
import inspect
import json
import logging
from pathlib import Path
from typing import Any, Coroutine, Optional, cast

from datum_ax._base import Contract
from datum_ax.contracts.inference import AssembledPrompt, ModelRole, TokenBudget
from datum_ax.core.utils import extract_json


class SynthesisResult(Contract):
    diff: str


def synthesize_test(
    lane: dict[str, Any],
    inference_client: Optional[Any] = None,
    crane: Optional[Any] = None,
) -> dict[str, Any]:
    """Stub implementation to synthesize a failing test (RED state)."""
    if inference_client:
        prompt_path = Path(__file__).parent.parent.parent / "prompts" / "red.md"
        prompt_text = prompt_path.read_text(encoding="utf-8")

        budget = TokenBudget(max_input=8000, max_output=1000, window_target=10000)
        system_text = prompt_text.replace("{{lane_json}}", json.dumps(lane))

        def _assemble(
            system: str, global_ast: str, diff: str, suffix: tuple[str, ...]
        ) -> AssembledPrompt:
            if crane is not None:
                return crane.assemble(system, global_ast, diff, suffix, budget=budget)
            return AssembledPrompt(system=system, global_ast=global_ast, diff=diff, suffix=suffix)

        prompt = _assemble(system_text, "", "", ())

        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "SynthesisResult",
                "schema": SynthesisResult.model_json_schema(),
                "strict": True,
            },
        }
        for attempt in range(3):
            call = inference_client.complete(
                role=ModelRole.EXECUTOR, prompt=prompt, budget=budget, response_format=format_dict
            )
            if inspect.isawaitable(call):
                completion = asyncio.run(cast(Coroutine[Any, Any, Any], call))
            else:
                completion = call

            try:
                parsed = extract_json(getattr(completion, "text", ""))
                if isinstance(parsed, list):
                    parsed = parsed[0] if parsed else {}
                return SynthesisResult.model_validate(parsed).model_dump()
            except Exception as e:
                logging.warning(
                    f"Synthesis error on attempt {attempt + 1}: {e}\nRaw output: {getattr(completion, 'text', '')}"
                )
                if attempt == 2:
                    return {
                        "diff": f"--- /dev/null\n+++ b/tests/test_{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def test_{lane.get('id', 'new')}():\n+    pass\n"
                    }
                prompt = _assemble(
                    prompt.system,
                    prompt.global_ast,
                    prompt.diff,
                    (
                        *prompt.suffix,
                        f'Your previous response failed validation: {e}\nOutput exactly {{"diff": "<unified diff>"}}.',
                    ),
                )

    return {
        "diff": f"--- /dev/null\n+++ b/tests/test_{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def test_{lane.get('id', 'new')}():\n+    pass\n"
    }


def synthesize_impl(
    lane: dict[str, Any],
    inference_client: Optional[Any] = None,
    crane: Optional[Any] = None,
) -> dict[str, Any]:
    """Stub implementation to synthesize the implementation code (GREEN state)."""
    if inference_client:
        prompt_path = Path(__file__).parent.parent.parent / "prompts" / "green.md"
        prompt_text = prompt_path.read_text(encoding="utf-8")

        budget = TokenBudget(max_input=8000, max_output=2000, window_target=10000)
        system_text = prompt_text.replace("{{lane_json}}", json.dumps(lane))

        def _assemble(
            system: str, global_ast: str, diff: str, suffix: tuple[str, ...]
        ) -> AssembledPrompt:
            if crane is not None:
                return crane.assemble(system, global_ast, diff, suffix, budget=budget)
            return AssembledPrompt(system=system, global_ast=global_ast, diff=diff, suffix=suffix)

        prompt = _assemble(system_text, "", "", ())

        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "SynthesisResult",
                "schema": SynthesisResult.model_json_schema(),
                "strict": True,
            },
        }
        for attempt in range(3):
            call = inference_client.complete(
                role=ModelRole.EXECUTOR, prompt=prompt, budget=budget, response_format=format_dict
            )
            if inspect.isawaitable(call):
                completion = asyncio.run(cast(Coroutine[Any, Any, Any], call))
            else:
                completion = call

            try:
                parsed = extract_json(getattr(completion, "text", ""))
                if isinstance(parsed, list):
                    parsed = parsed[0] if parsed else {}
                return SynthesisResult.model_validate(parsed).model_dump()
            except Exception as e:
                logging.warning(
                    f"Synthesis error on attempt {attempt + 1}: {e}\nRaw output: {getattr(completion, 'text', '')}"
                )
                if attempt == 2:
                    return {
                        "diff": f"--- /dev/null\n+++ b/src/{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def {lane.get('id', 'new')}():\n+    pass\n"
                    }
                prompt = _assemble(
                    prompt.system,
                    prompt.global_ast,
                    prompt.diff,
                    (
                        *prompt.suffix,
                        f'Your previous response failed validation: {e}\nOutput exactly {{"diff": "<unified diff>"}}.',
                    ),
                )

    return {
        "diff": f"--- /dev/null\n+++ b/src/{lane.get('id', 'new')}.py\n@@ -0,0 +1,2 @@\n+def {lane.get('id', 'new')}():\n+    pass\n"
    }
