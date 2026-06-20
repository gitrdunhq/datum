"""Real OpenAI-compatible httpx transport for an oMLX endpoint (data tier, ADR-0003).

`httpx` is an optional extra (`pip install datum-ax[inference]`), imported lazily inside `complete`
so the package and its tests don't require it. Conforms to the `OmlxTransport` port and accepts an
injectable client so tests can run without a network or the httpx dependency.

This is the single canonical httpx transport — it merges the original E2 design (lazy optional
import, injectable client, defensive usage parsing) with the `/v1` URL normalization and logging
added during E3/E6 wiring.
"""

from __future__ import annotations

from typing import Any, cast

from datum_ax.data.inference.transport import OmlxTransport
from datum_ax.data.inference.wire import ChatRequest, ChatResponse, Usage
from datum_ax.observability import get_logger

logger = get_logger(__name__)


class HttpxTransport(OmlxTransport):
    """POST /v1/chat/completions against an oMLX (OpenAI-compatible) base URL."""

    def __init__(
        self, base_url: str, api_key: str | None = None, *, client: object | None = None
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client = client  # an httpx.AsyncClient, or None to create one per call

    async def complete(self, request: ChatRequest) -> ChatResponse:
        import httpx  # lazy: only needed for real calls (optional `inference` extra)

        url = (
            f"{self.base_url}/chat/completions"
            if self.base_url.endswith("/v1")
            else f"{self.base_url}/v1/chat/completions"
        )
        logger.debug("omlx_request", url=url, model=request.model)

        payload = request.model_dump()  # includes response_format when set
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}

        client = cast(Any, self._client) or httpx.AsyncClient(timeout=None)
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
        finally:
            if self._client is None:  # only close clients we created
                await client.aclose()

        choice = data["choices"][0]
        usage = data.get("usage", {})
        return ChatResponse(
            text=choice["message"]["content"],
            usage=Usage(
                input_tokens=int(usage.get("prompt_tokens", 0)),
                output_tokens=int(usage.get("completion_tokens", 0)),
            ),
            finish_reason=choice.get("finish_reason"),
        )
