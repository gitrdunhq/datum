import asyncio
import inspect
import json
from typing import Any, Coroutine, Optional, cast

from datum_ax._base import Contract
from datum_ax.contracts.inference import ModelRole, TokenBudget
from datum_ax.core.utils import extract_json
from datum_ax.observability import get_logger

logger = get_logger(__name__)


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
        if crane is None:
            raise ValueError("triage_ticket requires a ContextCrane (persona + assembly, ADR-0033)")
        budget = TokenBudget(max_input=8000, max_output=1000, window_target=10000)
        # Role prompt comes from the persona registry via the crane (ADR-0033), not a hardcoded file.
        system_text = crane.compose_system("triage").replace("{{input}}", json.dumps(ticket))

        # ContextCrane is the single assembler (ADR-0030).
        def _assemble(system: str, global_ast: str, diff: str, suffix: tuple[str, ...]) -> Any:
            return crane.assemble(system, global_ast, diff, suffix, budget=budget)

        prompt = _assemble(system_text, "", "", ())

        format_dict = {
            "type": "json_schema",
            "json_schema": {
                "name": "TriageDecision",
                "schema": TriageDecision.model_json_schema(),
                "strict": True,
            },
        }
        for attempt in range(3):
            call = inference_client.complete(
                role=ModelRole.TRIAGE, prompt=prompt, budget=budget, response_format=format_dict
            )

            if inspect.isawaitable(call):
                completion = asyncio.run(cast(Coroutine[Any, Any, Any], call))
            else:
                completion = call

            try:
                parsed = extract_json(getattr(completion, "text", ""))
                if isinstance(parsed, list):
                    parsed = parsed[0] if parsed else {}
                return TriageDecision.model_validate(parsed).model_dump()
            except Exception as e:
                logger.warning(
                    "triage_parse_failed",
                    attempt=attempt + 1,
                    error=str(e),
                    raw_output=getattr(completion, "text", ""),
                )
                if attempt == 2:
                    break
                prompt = _assemble(
                    prompt.system,
                    prompt.global_ast,
                    prompt.diff,
                    (
                        *prompt.suffix,
                        f"Your previous response:\n{getattr(completion, 'text', '')}\nFailed validation: {e}\nOutput EXACTLY the requested JSON schema.",
                    ),
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
