"""Tests for oMLX inference backend integration in local_llm.py."""

import json
import pytest
from unittest.mock import MagicMock, patch

_mlx_lm_available = True
try:
    import mlx_lm  # noqa: F401
except ImportError:
    _mlx_lm_available = False


def test_omlx_url_none_by_default():
    from datum.local_llm import _omlx_url

    with patch("datum.local_llm.load_config", return_value={}):
        assert _omlx_url() is None


def test_omlx_url_from_config():
    from datum.local_llm import _omlx_url

    with patch(
        "datum.local_llm.load_config",
        return_value={"omlx_url": "http://localhost:8000"},
    ):
        assert _omlx_url() == "http://localhost:8000"


def test_omlx_available_false_when_no_url():
    from datum.local_llm import _omlx_available

    with patch("datum.local_llm.load_config", return_value={}):
        assert _omlx_available() is False


def test_omlx_available_false_when_server_down():
    from datum.local_llm import _omlx_available

    with patch(
        "datum.local_llm.load_config",
        return_value={"omlx_url": "http://localhost:9999"},
    ):
        assert _omlx_available() is False


def test_omlx_available_true_when_healthy():
    from datum.local_llm import _omlx_available

    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)

    with (
        patch(
            "datum.local_llm.load_config",
            return_value={"omlx_url": "http://localhost:8000"},
        ),
        patch("datum.local_llm.urllib.request.urlopen", return_value=mock_resp),
    ):
        assert _omlx_available() is True


def test_omlx_generate_returns_text():
    from datum.local_llm import _omlx_generate

    response_body = json.dumps(
        {
            "choices": [{"message": {"content": "hello world"}}],
            "usage": {"completion_tokens": 2},
        }
    ).encode()

    mock_resp = MagicMock()
    mock_resp.read.return_value = response_body
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("datum.local_llm.urllib.request.urlopen", return_value=mock_resp):
        result = _omlx_generate(
            "hi", "Qwen3-30B-A3B-8bit", 512, 0.3, "http://localhost:8000"
        )

    assert result["text"] == "hello world"
    assert result["escalated"] is False


def test_omlx_structured_returns_data():
    from datum.local_llm import _omlx_structured
    from datum.models.triage_decision_schema import TriageDecision

    response_body = json.dumps(
        {
            "choices": [
                {
                    "message": {
                        "content": '{"decision":"deepen","reason":"multi-file change"}'
                    }
                }
            ],
            "usage": {"completion_tokens": 10},
        }
    ).encode()

    mock_resp = MagicMock()
    mock_resp.read.return_value = response_body
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("datum.local_llm.urllib.request.urlopen", return_value=mock_resp):
        result = _omlx_structured(
            "triage this",
            TriageDecision,
            "Qwen3-30B-A3B-8bit",
            512,
            "http://localhost:8000",
        )

    assert result["data"]["decision"] == "deepen"
    assert result["data"]["reason"] == "multi-file change"


def test_generate_routes_to_omlx_when_available():
    """generate() should call _omlx_generate when oMLX is up."""
    from datum.local_llm import generate

    with (
        patch("datum.local_llm._omlx_available", return_value=True),
        patch("datum.local_llm._omlx_url", return_value="http://localhost:8000"),
        patch(
            "datum.local_llm._omlx_generate",
            return_value={
                "text": "result",
                "tokens": 5,
                "time_s": 1.0,
                "model": "test",
                "escalated": False,
                "abort_reason": None,
                "context": {},
            },
        ) as mock_omlx,
    ):
        result = generate("hello", model_id="test-model")

    mock_omlx.assert_called_once()
    assert result["text"] == "result"


@pytest.mark.skipif(not _mlx_lm_available, reason="mlx_lm not installed")
def test_generate_falls_back_when_omlx_down():
    """generate() falls back to direct mlx_lm when oMLX is unavailable."""
    from datum.local_llm import generate

    with (
        patch("datum.local_llm._omlx_available", return_value=False),
        patch("datum.local_llm.load_model", return_value=(MagicMock(), MagicMock())),
        patch(
            "datum.local_llm.check_context_budget",
            return_value={"fits": True, "prompt_tokens": 5, "window": 131072},
        ),
        patch("datum.local_llm.load_config", return_value={}),
        patch("mlx_lm.stream_generate", return_value=iter([])),
    ):
        result = generate("hello", model_id="test-model")

    assert "text" in result


# ── Defect-3: empty message content retries ──────────────────────────────────


def test_omlx_call_retries_on_empty_content_then_succeeds():
    """Defect-3: a 200 with None/empty content should be retried, not raise
    immediately. On the second attempt a good response succeeds."""
    from datum.local_llm import _omlx_call

    empty_response = json.dumps(
        {"choices": [{"message": {"content": None}}], "usage": {}}
    ).encode()
    good_response = json.dumps(
        {"choices": [{"message": {"content": "hello"}}], "usage": {}}
    ).encode()

    call_count = 0

    def fake_urlopen(req, timeout=None, **kwargs):
        nonlocal call_count
        call_count += 1
        resp = MagicMock()
        resp.read.return_value = empty_response if call_count == 1 else good_response
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    with (
        patch("datum.local_llm._omlx_urlopen_with_retry", fake_urlopen),
        patch("datum.local_llm.time.sleep"),
    ):
        body = {"model": "test-model", "messages": []}
        data, elapsed = _omlx_call(body, "http://localhost:12200", 10, deadline=None)

    assert data["choices"][0]["message"]["content"] == "hello"
    assert call_count == 2


def test_omlx_call_raises_after_exhausting_retries_on_empty_content():
    """Defect-3: after max retries all returning empty content, raise ValueError."""
    from datum.local_llm import _omlx_call

    empty_response = json.dumps(
        {"choices": [{"message": {"content": ""}}], "usage": {}}
    ).encode()

    def fake_urlopen(req, timeout=None, **kwargs):
        resp = MagicMock()
        resp.read.return_value = empty_response
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        return resp

    import pytest

    with (
        patch("datum.local_llm._omlx_urlopen_with_retry", fake_urlopen),
        patch("datum.local_llm.time.sleep"),
        pytest.raises(ValueError, match="no content"),
    ):
        _omlx_call(
            {"model": "test-model", "messages": []},
            "http://localhost:12200",
            10,
            deadline=None,
        )
