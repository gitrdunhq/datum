"""Real OpenAI-compatible transport for oMLX (data tier). `httpx` is an optional extra, imported
lazily so the package (and tests) don't require it. Not exported from the package __init__.
"""

from __future__ import annotations

from datum_ax.data.inference.wire import ChatRequest, ChatResponse, Usage


class HttpxOmlxTransport:
    """POST /v1/chat/completions against an oMLX (OpenAI-compatible) base URL."""

    def __init__(self, base_url: str, api_key: str | None = None, *, client: object | None = None):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._client = client  # an httpx.AsyncClient, or None to create per-call

    async def complete(self, request: ChatRequest) -> ChatResponse:
        import httpx  # lazy: only needed for real calls

        payload = {
            "model": request.model,
            "messages": [{"role": m.role, "content": m.content} for m in request.messages],
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
        }
        if request.response_format:
            payload["response_format"] = request.response_format
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}
        from typing import cast, Any

        client = cast(Any, self._client) or httpx.AsyncClient(timeout=None)
        try:
            resp = await client.post(
                f"{self._base_url}/v1/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()
        finally:
            if self._client is None:
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
