"""OmlxInferenceClient (data tier) — implements the InferenceClient contract (ADR-0003).

Owns: role lookup, the concurrency semaphore (prevents parallel-prefill memory spikes), token-budget
enforcement (reject over-budget before dispatch), and mapping the wire response to a typed Completion.
The actual HTTP/transport is injected (fake for tests, httpx for real).
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from datum_ax.contracts.inference import (
    AssembledPrompt,
    Completion,
    ModelRole,
    TokenBudget,
)
from datum_ax.data.inference.errors import (
    BudgetExceededError,
    InferenceError,
    InferenceTimeoutError,
)
from datum_ax.data.inference.roles import ModelRoleRegistry
from datum_ax.data.inference.transport import OmlxTransport
from datum_ax.contracts.tokens import default_token_count
from datum_ax.data.inference.wire import ChatMessage, ChatRequest


class OmlxInferenceClient:
    """Concrete `contracts.InferenceClient`. Construct once per process; share across lanes."""

    def __init__(
        self,
        transport: OmlxTransport,
        registry: ModelRoleRegistry,
        *,
        max_connections: int = 2,
        token_counter: Callable[[str], int] = default_token_count,
        timeout_s: float | None = None,
    ) -> None:
        if max_connections < 1:
            raise ValueError("max_connections must be >= 1")
        self._transport = transport
        self._registry = registry
        self._sem = asyncio.Semaphore(max_connections)
        self._count = token_counter
        self._timeout = timeout_s
        self.max_connections = max_connections

    def _input_text(self, prompt: AssembledPrompt) -> str:
        if prompt.suffix:
            return prompt.stable_prefix() + "\n" + "\n".join(prompt.suffix)
        return prompt.stable_prefix()

    def _messages(self, prompt: AssembledPrompt) -> tuple[ChatMessage, ...]:
        user = f"{prompt.global_ast}\n{prompt.diff}"
        if prompt.suffix:
            user += "\n" + "\n".join(prompt.suffix)
        return (
            ChatMessage(role="system", content=prompt.system),
            ChatMessage(role="user", content=user),
        )

    async def complete(
        self,
        role: ModelRole,
        prompt: AssembledPrompt,
        budget: TokenBudget,
        response_format: dict[str, Any] | None = None,
    ) -> Completion:
        cfg = self._registry.get(role)
        estimate = self._count(self._input_text(prompt))
        if estimate > budget.max_input:
            raise BudgetExceededError(estimate, budget.max_input)

        request = ChatRequest(
            model=cfg.model_id,
            messages=self._messages(prompt),
            temperature=cfg.temperature,
            max_tokens=budget.max_output,
            response_format=response_format or cfg.response_format,
        )

        async with self._sem:
            try:
                call = self._transport.complete(request)
                response = (
                    await asyncio.wait_for(call, self._timeout)
                    if self._timeout is not None
                    else await call
                )
            except asyncio.TimeoutError as exc:
                raise InferenceTimeoutError(
                    f"inference exceeded {self._timeout}s for role {role.value!r}"
                ) from exc
            except InferenceError:
                raise
            except Exception as exc:  # transport failure → typed error
                raise InferenceError(f"transport failure: {exc}") from exc

        return Completion(
            text=response.text,
            model_id=cfg.model_id,
            role=role,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
            finish_reason=response.finish_reason,
        )
