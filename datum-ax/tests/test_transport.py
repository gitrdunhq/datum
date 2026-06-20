import pytest
from unittest.mock import patch

from datum_ax.data.inference.wire import ChatRequest, ChatMessage
from datum_ax.data.inference.transport_httpx import HttpxTransport


@pytest.mark.asyncio
async def test_httpx_transport_success():
    request = ChatRequest(
        model="gpt-4",
        messages=(ChatMessage(role="user", content="hello"),),
        temperature=0.0,
        max_tokens=100,
    )

    from unittest.mock import MagicMock

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "world"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "world"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }

    with patch("httpx.AsyncClient.post", return_value=mock_response) as mock_post:
        transport = HttpxTransport(base_url="http://fake", api_key="secret")
        response = await transport.complete(request)

        # Verify request mapping
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert kwargs["json"]["model"] == "gpt-4"
        assert kwargs["headers"]["Authorization"] == "Bearer secret"

        # Verify response mapping
        assert response.text == "world"
        assert response.usage.input_tokens == 10
        assert response.usage.output_tokens == 20
        assert response.finish_reason == "stop"
