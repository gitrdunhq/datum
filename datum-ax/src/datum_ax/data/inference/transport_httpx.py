import logging

import httpx
from datum_ax.data.inference.transport import OmlxTransport
from datum_ax.data.inference.wire import ChatRequest, ChatResponse, Usage

logger = logging.getLogger("datum_ax.httpx")


class HttpxTransport(OmlxTransport):
    """Real transport to an oMLX endpoint using httpx."""

    def __init__(self, base_url: str, api_key: str):
        # normalize trailing slashes
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def complete(self, request: ChatRequest) -> ChatResponse:
        url = (
            f"{self.base_url}/chat/completions"
            if self.base_url.endswith("/v1")
            else f"{self.base_url}/v1/chat/completions"
        )

        logger.debug(f"POST {url} (model: {request.model})")

        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        # Pydantic model dump to dict
        payload = request.model_dump()

        async with httpx.AsyncClient(timeout=None) as client:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

            choice = data["choices"][0]
            usage = data["usage"]

            return ChatResponse(
                text=choice["message"]["content"],
                usage=Usage(
                    input_tokens=usage["prompt_tokens"], output_tokens=usage["completion_tokens"]
                ),
                finish_reason=choice.get("finish_reason"),
            )
