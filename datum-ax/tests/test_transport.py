import pytest

from datum_ax.data.inference.transport_httpx import HttpxTransport
from datum_ax.data.inference.wire import ChatMessage, ChatRequest


class _FakeResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    """Stand-in for httpx.AsyncClient — records the call, returns a canned response.

    Injecting this exercises HttpxTransport without httpx or a network (the transport's
    optional-extra design point).
    """

    def __init__(self, payload: dict):
        self._payload = payload
        self.calls: list[tuple] = []

    async def post(self, url, json, headers):
        self.calls.append((url, json, headers))
        return _FakeResponse(self._payload)


@pytest.mark.asyncio
async def test_httpx_transport_success():
    request = ChatRequest(
        model="gpt-4",
        messages=(ChatMessage(role="user", content="hello"),),
        temperature=0.0,
        max_tokens=100,
    )
    fake = _FakeClient(
        {
            "choices": [{"message": {"content": "world"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 20},
        }
    )

    transport = HttpxTransport(base_url="http://fake", api_key="secret", client=fake)
    response = await transport.complete(request)

    # Request mapping: /v1 appended, model + auth header carried through.
    url, body, headers = fake.calls[0]
    assert url == "http://fake/v1/chat/completions"
    assert body["model"] == "gpt-4"
    assert headers["Authorization"] == "Bearer secret"

    # Response mapping.
    assert response.text == "world"
    assert response.usage.input_tokens == 10
    assert response.usage.output_tokens == 20
    assert response.finish_reason == "stop"


@pytest.mark.asyncio
async def test_httpx_transport_tolerates_missing_usage():
    """Defensive parsing: a response without `usage` yields zeroed token counts, not a KeyError."""
    request = ChatRequest(
        model="gpt-4",
        messages=(ChatMessage(role="user", content="hi"),),
        temperature=0.0,
        max_tokens=10,
    )
    fake = _FakeClient({"choices": [{"message": {"content": "ok"}}]})

    response = await HttpxTransport(base_url="http://fake/v1", client=fake).complete(request)

    assert response.text == "ok"
    assert response.usage.input_tokens == 0
    assert response.usage.output_tokens == 0
    assert response.finish_reason is None
    # base_url already ends in /v1 → not doubled.
    assert fake.calls[0][0] == "http://fake/v1/chat/completions"
