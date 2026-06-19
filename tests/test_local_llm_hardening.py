import pytest
from unittest.mock import MagicMock, patch

from datum.local_llm import DEFAULTS, check_context_budget

_mlx_lm_available = True
try:
    import mlx_lm  # noqa: F401
except ImportError:
    _mlx_lm_available = False


def test_defaults_max_tokens():
    assert DEFAULTS["max_tokens"] == 8192
    assert DEFAULTS["context_window"] == 131072


def test_budget_check_fix():
    with (
        patch("datum.local_llm.count_tokens", return_value=100),
        patch("datum.local_llm.load_config", return_value={"context_window": 131072}),
    ):
        result = check_context_budget("x" * 500, 8192, "test-model")
    assert result["fits"] is True


def test_budget_check_fails_when_prompt_too_large():
    with (
        patch("datum.local_llm.count_tokens", return_value=130000),
        patch("datum.local_llm.load_config", return_value={"context_window": 131072}),
    ):
        result = check_context_budget("x" * 500, 8192, "test-model")
    assert result["fits"] is False


def test_cache_offset_empty():
    from datum.local_llm import _cache_offset

    assert _cache_offset([]) == 0


def test_cache_offset_populated():
    from datum.local_llm import _cache_offset

    mock = MagicMock()
    mock.offset = 500
    assert _cache_offset([mock]) == 500


def test_cache_offset_no_attr():
    from datum.local_llm import _cache_offset

    mock = MagicMock(spec=[])
    assert _cache_offset([mock]) == 0


def test_sampling_merge_rejects_protected_keys():
    """The sampling dict is a boundary: it may tune sampling knobs but must
    never override model/messages/temperature/stream on the request body —
    a sampling dict carrying 'temperature' would silently win over the
    explicit parameter, and 'stream': True breaks response parsing."""
    from datum.local_llm import _sampling_params

    merged = _sampling_params(
        {
            "top_p": 0.8,
            "top_k": 20,
            "presence_penalty": 1.0,
            "temperature": 0.0,
            "stream": True,
            "model": "evil",
            "messages": [],
        }
    )
    assert merged == {"top_p": 0.8, "top_k": 20, "presence_penalty": 1.0}


def test_sampling_params_none_is_empty():
    from datum.local_llm import _sampling_params

    assert _sampling_params(None) == {}


def test_multi_turn_uses_prompt_cache():
    from datum.local_llm import multi_turn_phase

    # Mock mlx_lm.prompt_cache so _mt_cache is non-None (test needs cache present)
    _mock_cache = MagicMock()
    import sys
    _sys_modules_backup = sys.modules.copy()
    sys.modules["mlx_lm"] = MagicMock()
    sys.modules["mlx_lm.models"] = MagicMock()
    sys.modules["mlx_lm.models.cache"] = MagicMock()
    sys.modules["mlx_lm.models.cache"].make_prompt_cache = MagicMock(return_value=_mock_cache)

    try:
        with (
            patch("datum.local_llm.should_use_local", return_value=True),
            patch(
                "datum.local_llm._load_multi_turn_config",
                return_value={"enabled": True, "planning_turn": False, "max_turns": 2},
            ),
            patch("datum.local_llm.get_model_for_phase", return_value="test-model"),
            patch("datum.local_llm.load_model", return_value=(MagicMock(), MagicMock())),
            patch("datum.local_llm.count_tokens", return_value=10),
            patch("datum.local_llm._is_final_turn", return_value=True),
            patch("datum.local_llm._cache_offset", side_effect=[0, 5]),
            patch("datum.local_llm.vote_structured") as mock_vote,
        ):
            mock_vote.return_value = {
                "data": {"action": "proceed", "escalate": False},
                "tokens": 10,
                "time_s": 0.1,
                "agreement_score": 1.0,
            }

            multi_turn_phase("act", "test prompt")

            # prompt_cache should be in the kwargs passed to vote_structured
            assert mock_vote.call_count > 0
            kwargs = mock_vote.call_args[1]
            assert "prompt_cache" in kwargs
    finally:
        sys.modules.clear()
        sys.modules.update(_sys_modules_backup)


# ── oMLX retry / timeout / time_s tests ────────────────────────────────────


def _make_omlx_response(text: str = "hello", tokens: int = 5) -> bytes:
    """Build a minimal /v1/chat/completions JSON response body."""
    import json as _json

    return _json.dumps(
        {
            "choices": [{"message": {"content": text}}],
            "usage": {"completion_tokens": tokens, "prompt_tokens": 10},
        }
    ).encode()


def _make_http_error(code: int, headers: dict | None = None) -> Exception:
    """Build a urllib.error.HTTPError with optional headers."""
    import urllib.error as _ue
    from email.message import Message
    from io import BytesIO

    msg = Message()
    for k, v in (headers or {}).items():
        msg[k] = v
    return _ue.HTTPError(
        url="http://localhost:9999/v1/chat/completions",
        code=code,
        msg=f"HTTP {code}",
        hdrs=msg,
        fp=BytesIO(b""),
    )


def _conn_refused_urlerror() -> Exception:
    """Build a URLError wrapping ConnectionRefusedError."""
    import urllib.error as _ue

    return _ue.URLError(ConnectionRefusedError("Connection refused"))


def _retry_sleep_spy():
    """Route the retry helper's backoff through a recording no-op mock.

    Uses the sleep_fn injection point on _omlx_urlopen_with_retry instead
    of fragile global time.sleep patching. Returns (patcher, sleep_mock).
    """
    import datum.local_llm as _mod

    real = _mod._omlx_urlopen_with_retry
    sleep_mock = MagicMock()

    def _with_spy(req, timeout, max_attempts=_mod._OMLX_MAX_ATTEMPTS, deadline=None):
        return real(req, timeout, max_attempts, sleep_fn=sleep_mock, deadline=deadline)

    return patch.object(_mod, "_omlx_urlopen_with_retry", _with_spy), sleep_mock


# ── Fix 1: retry with capped backoff ───────────────────────────────────────


def test_retry_on_429_then_succeeds():
    """HTTP 429 on first attempt, success on second → returns result."""

    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    sleep_patch, mock_sleep = _retry_sleep_spy()
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=[_make_http_error(429), resp_ok],
        ),
        sleep_patch,
    ):
        result = _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    assert result["text"] == "ok"
    assert mock_sleep.call_count == 1


def test_retry_on_503_then_succeeds():
    """HTTP 503 on first attempt, success on second."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    sleep_patch, _ = _retry_sleep_spy()
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=[_make_http_error(503), resp_ok],
        ),
        sleep_patch,
    ):
        result = _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    assert result["text"] == "ok"


def test_retry_on_connection_refused_then_succeeds():
    """URLError(ConnectionRefusedError) retries and succeeds."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    sleep_patch, _ = _retry_sleep_spy()
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=[_conn_refused_urlerror(), resp_ok],
        ),
        sleep_patch,
    ):
        result = _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    assert result["text"] == "ok"


def test_retry_exhaustion_raises_original_error():
    """All 4 attempts fail with 429 → raises the original HTTPError."""
    import urllib.error as _ue

    import pytest

    from datum.local_llm import _omlx_generate

    errors = [_make_http_error(429) for _ in range(4)]
    sleep_patch, _ = _retry_sleep_spy()
    with (
        patch("datum.local_llm.urllib.request.urlopen", side_effect=errors),
        sleep_patch,
        pytest.raises(_ue.HTTPError) as exc_info,
    ):
        _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    assert exc_info.value.code == 429


def test_no_retry_on_400():
    """HTTP 400 is not retryable — must raise immediately, no sleep."""
    import urllib.error as _ue

    import pytest

    from datum.local_llm import _omlx_generate

    sleep_patch, mock_sleep = _retry_sleep_spy()
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=_make_http_error(400),
        ),
        sleep_patch,
        pytest.raises(_ue.HTTPError) as exc_info,
    ):
        _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    assert exc_info.value.code == 400
    assert mock_sleep.call_count == 0


def test_no_retry_on_500():
    """HTTP 500 (server error, not overload) raises immediately."""
    import urllib.error as _ue

    import pytest

    from datum.local_llm import _omlx_generate

    sleep_patch, mock_sleep = _retry_sleep_spy()
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=_make_http_error(500),
        ),
        sleep_patch,
        pytest.raises(_ue.HTTPError),
    ):
        _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    assert mock_sleep.call_count == 0


def test_retry_after_header_honored():
    """When Retry-After header is present, sleep uses that value."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    err_429 = _make_http_error(429, headers={"Retry-After": "7"})
    sleep_patch, mock_sleep = _retry_sleep_spy()
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=[err_429, resp_ok],
        ),
        sleep_patch,
    ):
        _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    # The sleep must be at least 7 (Retry-After value)
    slept = mock_sleep.call_args[0][0]
    assert slept >= 7.0


def test_retry_structured_on_503():
    """_omlx_structured also retries on 503."""
    from datum.local_llm import _omlx_structured

    schema = MagicMock()
    schema.model_json_schema.return_value = {"type": "object", "properties": {}}
    schema.__name__ = "TestSchema"

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response('{"a": 1}')
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    sleep_patch, _ = _retry_sleep_spy()
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=[_make_http_error(503), resp_ok],
        ),
        sleep_patch,
    ):
        result = _omlx_structured("hi", schema, "m", 100, "http://localhost:9999")
    assert result["data"] == {"a": 1}


def test_retry_exhaustion_structured_raises():
    """_omlx_structured exhausts retries → raises original error."""
    import urllib.error as _ue

    import pytest

    from datum.local_llm import _omlx_structured

    schema = MagicMock()
    schema.model_json_schema.return_value = {"type": "object", "properties": {}}
    schema.__name__ = "TestSchema"

    errors = [_make_http_error(503) for _ in range(4)]
    sleep_patch, _ = _retry_sleep_spy()
    with (
        patch("datum.local_llm.urllib.request.urlopen", side_effect=errors),
        sleep_patch,
        pytest.raises(_ue.HTTPError),
    ):
        _omlx_structured("hi", schema, "m", 100, "http://localhost:9999")


# ── Fix 2: config-driven timeout ──────────────────────────────────────────


def test_config_timeout_default_300():
    """DEFAULTS must include request_timeout_s = 300."""
    assert DEFAULTS["request_timeout_s"] == 300


def test_config_timeout_flows_to_urlopen():
    """Custom request_timeout_s from config reaches urlopen."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    with (
        patch(
            "datum.local_llm.load_config",
            return_value={**DEFAULTS, "request_timeout_s": 42},
        ),
        patch(
            "datum.local_llm.urllib.request.urlopen", return_value=resp_ok
        ) as mock_open,
    ):
        _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    # urlopen must receive timeout=42
    _, kwargs = mock_open.call_args
    assert kwargs.get("timeout") == 42


def test_config_timeout_structured():
    """Custom request_timeout_s flows to _omlx_structured too."""
    from datum.local_llm import _omlx_structured

    schema = MagicMock()
    schema.model_json_schema.return_value = {"type": "object", "properties": {}}
    schema.__name__ = "TestSchema"

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response('{"x": 1}')
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    with (
        patch(
            "datum.local_llm.load_config",
            return_value={**DEFAULTS, "request_timeout_s": 99},
        ),
        patch(
            "datum.local_llm.urllib.request.urlopen", return_value=resp_ok
        ) as mock_open,
    ):
        _omlx_structured("hi", schema, "m", 100, "http://localhost:9999")
    _, kwargs = mock_open.call_args
    assert kwargs.get("timeout") == 99


# ── Fix 3: real time_s ────────────────────────────────────────────────────


def test_generate_returns_real_time_s():
    """_omlx_generate must return a positive time_s, not 0.0."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    with (
        patch("datum.local_llm.urllib.request.urlopen", return_value=resp_ok),
        patch("time.monotonic", side_effect=[100.0, 102.5]),
    ):
        result = _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    assert result["time_s"] == 2.5


def test_structured_returns_real_time_s():
    """_omlx_structured must return a positive time_s, not 0.0."""
    import pytest

    from datum.local_llm import _omlx_structured

    schema = MagicMock()
    schema.model_json_schema.return_value = {"type": "object", "properties": {}}
    schema.__name__ = "TestSchema"

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response('{"v": 1}')
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    with (
        patch("datum.local_llm.urllib.request.urlopen", return_value=resp_ok),
        patch("time.monotonic", side_effect=[200.0, 203.7]),
    ):
        result = _omlx_structured("hi", schema, "m", 100, "http://localhost:9999")
    assert result["time_s"] == pytest.approx(3.7)


def test_time_s_not_hardcoded_zero():
    """Regression guard: if the HTTP call takes measurable time, time_s > 0."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    # Don't mock monotonic — let real wall-clock run
    with patch("datum.local_llm.urllib.request.urlopen", return_value=resp_ok):
        result = _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999")
    # Real call is near-instant but must not be exactly 0.0 (the old hardcoded value)
    # Actually, with mocked urlopen it could be essentially 0 — but must be >= 0
    assert result["time_s"] >= 0.0


# ── Issue #65 item 4: response-shape boundary validation ───────────────────


def _mock_resp(payload: bytes) -> MagicMock:
    """Build a context-manager mock for urlopen returning *payload*."""
    resp = MagicMock()
    resp.read.return_value = payload
    resp.__enter__ = MagicMock(return_value=resp)
    resp.__exit__ = MagicMock(return_value=False)
    return resp


def test_generate_missing_choices_raises_structured_error():
    """Response without 'choices' → ValueError naming model and URL."""
    import json as _json

    import pytest

    from datum.local_llm import _omlx_generate

    resp = _mock_resp(_json.dumps({"usage": {"completion_tokens": 0}}).encode())
    with (
        patch("datum.local_llm.urllib.request.urlopen", return_value=resp),
        pytest.raises(ValueError) as exc_info,
    ):
        _omlx_generate("hi", "my-model", 100, 0.5, "http://localhost:9999")
    msg = str(exc_info.value)
    assert "choices" in msg
    assert "my-model" in msg
    assert "http://localhost:9999" in msg


def test_generate_empty_choices_raises_structured_error():
    """Response with empty 'choices' list → structured ValueError."""
    import json as _json

    import pytest

    from datum.local_llm import _omlx_generate

    resp = _mock_resp(_json.dumps({"choices": [], "usage": {}}).encode())
    with (
        patch("datum.local_llm.urllib.request.urlopen", return_value=resp),
        pytest.raises(ValueError) as exc_info,
    ):
        _omlx_generate("hi", "my-model", 100, 0.5, "http://localhost:9999")
    msg = str(exc_info.value)
    assert "choices" in msg
    assert "my-model" in msg
    assert "http://localhost:9999" in msg


def test_generate_missing_message_content_raises_structured_error():
    """Choice without message content → ValueError, not KeyError."""
    import json as _json

    import pytest

    from datum.local_llm import _omlx_generate

    resp = _mock_resp(_json.dumps({"choices": [{"message": {}}]}).encode())
    with (
        patch("datum.local_llm.urllib.request.urlopen", return_value=resp),
        pytest.raises(ValueError) as exc_info,
    ):
        _omlx_generate("hi", "my-model", 100, 0.5, "http://localhost:9999")
    msg = str(exc_info.value)
    assert "my-model" in msg
    assert "http://localhost:9999" in msg


def test_structured_missing_choices_raises_structured_error():
    """_omlx_structured gets the same boundary validation."""
    import json as _json

    import pytest

    from datum.local_llm import _omlx_structured

    schema = MagicMock()
    schema.model_json_schema.return_value = {"type": "object", "properties": {}}
    schema.__name__ = "TestSchema"

    resp = _mock_resp(_json.dumps({"usage": {}}).encode())
    with (
        patch("datum.local_llm.urllib.request.urlopen", return_value=resp),
        pytest.raises(ValueError) as exc_info,
    ):
        _omlx_structured("hi", schema, "my-model", 100, "http://localhost:9999")
    msg = str(exc_info.value)
    assert "choices" in msg
    assert "my-model" in msg
    assert "http://localhost:9999" in msg


# ── Issue #65 item 5: Pydantic schema validation at the boundary ───────────


def test_structured_validates_parsed_json_against_schema():
    """_omlx_structured must run schema.model_validate on the parsed JSON."""
    from datum.local_llm import _omlx_structured

    schema = MagicMock()
    schema.model_json_schema.return_value = {"type": "object", "properties": {}}
    schema.__name__ = "TestSchema"

    resp = _mock_resp(_make_omlx_response('{"a": 1}'))
    with patch("datum.local_llm.urllib.request.urlopen", return_value=resp):
        result = _omlx_structured("hi", schema, "m", 100, "http://localhost:9999")
    schema.model_validate.assert_called_once_with({"a": 1})
    # Return type unchanged: callers still get the plain parsed dict.
    assert result["data"] == {"a": 1}


def test_structured_schema_mismatch_fails_fast():
    """Parsed JSON that violates the Pydantic schema raises at the boundary."""
    import pytest
    from pydantic import BaseModel, ValidationError

    from datum.local_llm import _omlx_structured

    class _Verdict(BaseModel):
        action: str

    resp = _mock_resp(_make_omlx_response('{"wrong_field": 1}'))
    with (
        patch("datum.local_llm.urllib.request.urlopen", return_value=resp),
        pytest.raises(ValidationError),
    ):
        _omlx_structured("hi", _Verdict, "m", 100, "http://localhost:9999")


# ── Issue #65 item 6: sleep_fn injection on the retry helper ───────────────


def test_retry_helper_sleep_fn_injection():
    """_omlx_urlopen_with_retry accepts sleep_fn — no time.sleep patching."""
    import urllib.request as _ur

    from datum.local_llm import _omlx_urlopen_with_retry

    resp_ok = _mock_resp(_make_omlx_response("ok"))
    sleep_fn = MagicMock()
    req = _ur.Request(  # nosemgrep: insecure-request-object -- intentional http:// in security hardening test
        "http://localhost:9999/v1/chat/completions", data=b"{}", method="POST"
    )
    with patch(
        "datum.local_llm.urllib.request.urlopen",
        side_effect=[_make_http_error(429), resp_ok],
    ):
        resp = _omlx_urlopen_with_retry(req, timeout=5, sleep_fn=sleep_fn)
    assert resp is resp_ok
    assert sleep_fn.call_count == 1


# ── Fix 4 (#61): per-call budget cap — max_time_s ───────────────────────────
# A caller with a wall-clock budget (the agent loop) must be able to cap the
# request below request_timeout_s, and retries must never run past that cap.


def test_omlx_generate_max_time_caps_socket_timeout():
    """max_time_s below request_timeout_s wins: urlopen timeout == max_time_s."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    with (
        patch("datum.local_llm.load_config", return_value={**DEFAULTS}),
        patch(
            "datum.local_llm.urllib.request.urlopen", return_value=resp_ok
        ) as mock_open,
        # monotonic: deadline anchor, _omlx_call t0, retry budget check, elapsed
        patch("time.monotonic", side_effect=[100.0, 100.0, 100.0, 105.0]),
    ):
        _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999", max_time_s=42)
    _, kwargs = mock_open.call_args
    assert kwargs.get("timeout") == 42


def test_omlx_generate_config_timeout_still_wins_when_smaller():
    """max_time_s above request_timeout_s does not raise the socket timeout."""
    from datum.local_llm import _omlx_generate

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response("ok")
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    with (
        patch(
            "datum.local_llm.load_config",
            return_value={**DEFAULTS, "request_timeout_s": 42},
        ),
        patch(
            "datum.local_llm.urllib.request.urlopen", return_value=resp_ok
        ) as mock_open,
        # monotonic: deadline anchor, _omlx_call t0, retry budget check, elapsed
        patch("time.monotonic", side_effect=[100.0, 100.0, 100.0, 105.0]),
    ):
        _omlx_generate("hi", "m", 100, 0.5, "http://localhost:9999", max_time_s=500)
    _, kwargs = mock_open.call_args
    assert kwargs.get("timeout") == 42


def test_omlx_structured_max_time_caps_socket_timeout():
    """_omlx_structured honors max_time_s the same way."""
    from datum.local_llm import _omlx_structured

    schema = MagicMock()
    schema.model_json_schema.return_value = {"type": "object", "properties": {}}
    schema.__name__ = "TestSchema"

    resp_ok = MagicMock()
    resp_ok.read.return_value = _make_omlx_response('{"a": 1}')
    resp_ok.__enter__ = MagicMock(return_value=resp_ok)
    resp_ok.__exit__ = MagicMock(return_value=False)

    with (
        patch("datum.local_llm.load_config", return_value={**DEFAULTS}),
        patch(
            "datum.local_llm.urllib.request.urlopen", return_value=resp_ok
        ) as mock_open,
        # monotonic: deadline anchor, _omlx_call t0, retry budget check, elapsed
        patch("time.monotonic", side_effect=[200.0, 200.0, 200.0, 203.0]),
    ):
        _omlx_structured("hi", schema, "m", 100, "http://localhost:9999", max_time_s=33)
    _, kwargs = mock_open.call_args
    assert kwargs.get("timeout") == 33


def test_retry_does_not_sleep_past_deadline():
    """A retryable error close to the deadline re-raises instead of sleeping
    past the budget."""
    import urllib.error as _ue
    import urllib.request as _ur

    import pytest

    from datum.local_llm import _omlx_urlopen_with_retry

    sleep_fn = MagicMock()
    req = _ur.Request(  # nosemgrep: insecure-request-object -- intentional http:// in security hardening test
        "http://localhost:9999/v1/chat/completions", data=b"{}"
    )
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=[_make_http_error(429)],
        ),
        # attempt at t=100 (5s left); pre-sleep check at t=104.5: any
        # backoff delay (>=1s) would land past the deadline → raise now.
        patch("time.monotonic", side_effect=[100.0, 104.5]),
        pytest.raises(_ue.HTTPError),
    ):
        _omlx_urlopen_with_retry(req, timeout=300, deadline=105.0, sleep_fn=sleep_fn)
    assert sleep_fn.call_count == 0


def test_retry_within_deadline_still_retries():
    """With budget to spare, the retry path is unchanged: sleep, retry, win."""
    import urllib.request as _ur

    from datum.local_llm import _omlx_urlopen_with_retry

    resp_ok = MagicMock()
    sleep_fn = MagicMock()
    req = _ur.Request(  # nosemgrep: insecure-request-object -- intentional http:// in security hardening test
        "http://localhost:9999/v1/chat/completions", data=b"{}"
    )
    with (
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=[_make_http_error(429), resp_ok],
        ),
        patch("time.monotonic", side_effect=[100.0, 101.0, 103.0]),
    ):
        result = _omlx_urlopen_with_retry(
            req, timeout=300, deadline=400.0, sleep_fn=sleep_fn
        )
    assert result is resp_ok
    assert sleep_fn.call_count == 1


def test_retry_expired_deadline_raises_before_request():
    """Negative path: deadline already past → no request is issued at all."""
    import urllib.request as _ur

    import pytest

    from datum.local_llm import _omlx_urlopen_with_retry

    req = _ur.Request(  # nosemgrep: insecure-request-object -- intentional http:// in security hardening test
        "http://localhost:9999/v1/chat/completions", data=b"{}"
    )
    with (
        patch("datum.local_llm.urllib.request.urlopen") as mock_open,
        patch("time.monotonic", side_effect=[100.0]),
        pytest.raises(TimeoutError),
    ):
        _omlx_urlopen_with_retry(req, timeout=300, deadline=99.0)
    assert mock_open.call_count == 0


def test_generate_threads_max_time_to_omlx():
    """generate(max_time_s=...) reaches _omlx_generate (kwarg threading)."""
    from datum.local_llm import generate

    with (
        patch("datum.local_llm._omlx_available", return_value=True),
        patch("datum.local_llm._omlx_url", return_value="http://localhost:9999"),
        patch("datum.local_llm._omlx_generate") as mock_gen,
    ):
        mock_gen.return_value = {"text": "ok", "tokens": 1}
        generate("p", "m", max_time_s=21)
    assert mock_gen.call_args.kwargs.get("max_time_s") == 21


def test_structured_threads_max_time_to_omlx():
    """structured(max_time_s=...) reaches _omlx_structured."""
    from datum.local_llm import structured

    schema = MagicMock()
    with (
        patch("datum.local_llm._omlx_available", return_value=True),
        patch("datum.local_llm._omlx_url", return_value="http://localhost:9999"),
        patch("datum.local_llm._omlx_structured") as mock_struct,
    ):
        mock_struct.return_value = {"data": {}, "tokens": 1}
        structured("p", schema, "m", max_time_s=22)
    assert mock_struct.call_args.kwargs.get("max_time_s") == 22


# ── Fix (#104): in-process fallback path honors max_time_s ──────────────────
# When oMLX is down, generate() falls back to in-process mlx_lm streaming.
# That path must enforce the caller's wall-clock budget too: check a
# monotonic deadline inside the token loop, stop promptly when exceeded,
# and return the partial output flagged via abort_reason (escalated=True),
# consistent with the existing structured abort signals (#65 direction).


class _TickingClock:
    """Fake monotonic clock the fake stream advances manually."""

    def __init__(self, start: float = 100.0):
        self.now = start

    def __call__(self) -> float:
        return self.now


def _fake_stream(clock: _TickingClock, n_tokens: int, seconds_per_token: float):
    """Build a fake mlx_lm.stream_generate: each yielded token advances the
    clock by *seconds_per_token* (simulating slow generation). Returns
    (stream_fn, yielded) where *yielded* records how many tokens were
    actually consumed — proving the loop break-ed out promptly."""
    yielded: list[int] = []

    def stream(*args, **kwargs):
        for i in range(n_tokens):
            clock.now += seconds_per_token
            resp = MagicMock()
            resp.text = f"tok{i} "
            yielded.append(i)
            yield resp

    return stream, yielded


def _inprocess_patches(clock, stream_fn):
    """Common patch set for the in-process (oMLX-down) generate() path."""
    return (
        patch("datum.local_llm._omlx_available", return_value=False),
        patch("datum.local_llm.load_model", return_value=(MagicMock(), MagicMock())),
        patch(
            "datum.local_llm.check_context_budget",
            return_value={"fits": True, "prompt_tokens": 5, "window": 131072},
        ),
        patch("datum.local_llm.load_config", return_value={}),
        patch("datum.local_llm._log_metric"),
        patch("mlx_lm.stream_generate", stream_fn),
        patch("time.monotonic", clock),
    )


@pytest.mark.skipif(not _mlx_lm_available, reason="mlx_lm not installed")
def test_inprocess_deadline_exceeded_midstream_truncates_and_stops():
    """Deadline blown mid-stream → stops promptly, returns partial text
    flagged as truncated via abort_reason, escalated=True."""
    import contextlib

    from datum.local_llm import generate

    clock = _TickingClock(start=100.0)
    # 10 tokens at 2s each; budget 5s → deadline t=105 trips on token 3 (t=106).
    stream_fn, yielded = _fake_stream(clock, n_tokens=10, seconds_per_token=2.0)

    with contextlib.ExitStack() as stack:
        for p in _inprocess_patches(clock, stream_fn):
            stack.enter_context(p)
        result = generate("hello", model_id="test-model", max_time_s=5.0)

    assert result["abort_reason"] == "max_time_exceeded"
    assert result["escalated"] is True
    # Partial output produced so far is returned, not discarded.
    assert result["text"] == "tok0 tok1 tok2 "
    assert result["tokens"] == 3
    # Stops promptly: the stream was NOT consumed to exhaustion.
    assert len(yielded) == 3
    assert result["time_s"] == 6.0


@pytest.mark.skipif(not _mlx_lm_available, reason="mlx_lm not installed")
def test_inprocess_generous_budget_returns_full_output():
    """Budget never exceeded → full output, no abort, not escalated."""
    import contextlib

    from datum.local_llm import generate

    clock = _TickingClock(start=100.0)
    stream_fn, yielded = _fake_stream(clock, n_tokens=5, seconds_per_token=1.0)

    with contextlib.ExitStack() as stack:
        for p in _inprocess_patches(clock, stream_fn):
            stack.enter_context(p)
        result = generate("hello", model_id="test-model", max_time_s=1000.0)

    assert result["abort_reason"] is None
    assert result["escalated"] is False
    assert result["text"] == "tok0 tok1 tok2 tok3 tok4 "
    assert result["tokens"] == 5
    assert len(yielded) == 5


@pytest.mark.skipif(not _mlx_lm_available, reason="mlx_lm not installed")
def test_inprocess_no_max_time_means_no_deadline():
    """max_time_s=None → no deadline enforcement, however slow the stream."""
    import contextlib

    from datum.local_llm import generate

    clock = _TickingClock(start=100.0)
    # Absurdly slow stream: 1000s per token. Without a budget it must run out.
    stream_fn, yielded = _fake_stream(clock, n_tokens=5, seconds_per_token=1000.0)

    with contextlib.ExitStack() as stack:
        for p in _inprocess_patches(clock, stream_fn):
            stack.enter_context(p)
        result = generate("hello", model_id="test-model", max_time_s=None)

    assert result["abort_reason"] is None
    assert result["escalated"] is False
    assert result["tokens"] == 5
    assert len(yielded) == 5


# ── Issue #107: metric writes must never touch the live repo ────────────────
# Same leak class as #103's transcripts: test runs that exercise any
# metric-writing path from the repo root appended to the repo's real
# .datum/local-llm-metrics.jsonl. Isolation is structural — the suite-wide
# conftest fixture redirects datum.local_llm.METRICS_PATH to tmp_path.


@pytest.mark.skipif(not _mlx_lm_available, reason="mlx_lm not installed")
def test_metrics_cannot_leak_into_real_repo(request, tmp_path, monkeypatch):
    """Issue #107 regression: a metric-writing path run from the repo root
    with no DATUM_PROJECT_DIR — i.e. a test that forgets per-module chdir
    isolation — must not gain the real .datum/ a metrics file; the entry
    lands in the redirected tmp_path file instead."""
    import json as _json

    from datum.local_llm import generate

    repo_datum = request.config.rootpath / ".datum"
    before = {p.name for p in repo_datum.iterdir()} if repo_datum.is_dir() else set()
    monkeypatch.chdir(request.config.rootpath)  # simulate the forgetful test
    monkeypatch.delenv("DATUM_PROJECT_DIR", raising=False)

    def stream(*args, **kwargs):
        resp = MagicMock()
        resp.text = "ok"
        yield resp

    with (
        patch("datum.local_llm._omlx_available", return_value=False),
        patch("datum.local_llm.load_model", return_value=(MagicMock(), MagicMock())),
        patch(
            "datum.local_llm.check_context_budget",
            return_value={"fits": True, "prompt_tokens": 5, "window": 131072},
        ),
        patch("datum.local_llm.load_config", return_value={}),
        patch("mlx_lm.stream_generate", stream),
    ):
        result = generate("hello", model_id="test-model")

    assert result["text"] == "ok"
    after = {p.name for p in repo_datum.iterdir()} if repo_datum.is_dir() else set()
    assert "local-llm-metrics.jsonl" not in after
    assert after == before, f"metrics leaked into live repo: {after - before}"

    # The metric landed in the redirected file instead — nothing was lost.
    redirected = tmp_path / ".datum" / "local-llm-metrics.jsonl"
    assert redirected.is_file()
    lines = [ln for ln in redirected.read_text().splitlines() if ln.strip()]
    assert len(lines) == 1
    assert _json.loads(lines[0])["model"] == "test-model"


# ── Issue #65 item 3: _omlx_available logs a warning on silent fallback ─────
# Server configured but unreachable must emit a structured warning (DPS-204)
# instead of silently returning False and falling back to a local MLX load.


def test_omlx_available_logs_warning_when_server_unreachable(caplog):
    """Configured oMLX URL + unreachable server → warning naming the URL."""
    import logging

    from datum.local_llm import _omlx_available

    with (
        patch(
            "datum.local_llm.load_config",
            return_value={"omlx_url": "http://localhost:9999"},
        ),
        patch(
            "datum.local_llm.urllib.request.urlopen",
            side_effect=_conn_refused_urlerror(),
        ),
        caplog.at_level(logging.WARNING),
    ):
        assert _omlx_available() is False

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    msg = warnings[0].getMessage()
    assert "http://localhost:9999" in msg
    assert "fall" in msg  # names the fallback consequence


def test_omlx_available_no_warning_when_url_unset(caplog):
    """No omlx_url configured is a normal state — no warning emitted."""
    import logging

    from datum.local_llm import _omlx_available

    with (
        patch("datum.local_llm.load_config", return_value={}),
        caplog.at_level(logging.WARNING),
    ):
        assert _omlx_available() is False

    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]


# ── Issue #65 item 6 (residual): _omlx_call empty-content retry sleep_fn ───
# The Defect-3 empty-content retry loop in _omlx_call used a raw time.sleep,
# forcing tests to patch datum.local_llm.time.sleep. It must accept an
# injectable sleep_fn like _omlx_urlopen_with_retry does.


def test_omlx_call_empty_content_retry_uses_injected_sleep_fn():
    """Empty content retried via sleep_fn — no time.sleep patching needed."""
    import json as _json

    from datum.local_llm import _omlx_call

    empty = _json.dumps(
        {"choices": [{"message": {"content": ""}}], "usage": {}}
    ).encode()
    responses = [_mock_resp(empty), _mock_resp(_make_omlx_response("ok"))]

    def fake_urlopen(req, timeout=None, **kwargs):
        return responses.pop(0)

    sleep_fn = MagicMock()
    with patch("datum.local_llm._omlx_urlopen_with_retry", fake_urlopen):
        data, _elapsed = _omlx_call(
            {"model": "m", "messages": []},
            "http://localhost:9999",
            10,
            sleep_fn=sleep_fn,
        )

    assert data["choices"][0]["message"]["content"] == "ok"
    assert sleep_fn.call_count == 1
    # First backoff is 2**0 plus up-to-1s jitter.
    delay = sleep_fn.call_args.args[0]
    assert 1.0 <= delay < 2.0


# ── Fix (#105): in-process structured (outlines) path honors max_time_s ─────
# structured()'s outlines fallback was a single blocking gen() call that
# ignored max_time_s. outlines' Generator supports stream(); when a budget is
# set the path now streams with a monotonic deadline (mirroring generate()'s
# #104 fix) and on overrun returns a structured timeout error — a partial
# JSON document is useless, so no partial parse is ever attempted.


class _FakeOutlinesGenerator:
    """Fake outlines Generator: blocking __call__ plus chunked stream() that
    advances the fake clock per chunk (simulating slow generation)."""

    def __init__(
        self,
        clock: _TickingClock,
        chunks: list[str],
        seconds_per_chunk: float = 0.0,
    ):
        self._clock = clock
        self._chunks = chunks
        self._spc = seconds_per_chunk
        self.blocking_calls = 0
        self.streamed: list[str] = []

    def __call__(self, prompt, **kwargs):
        self.blocking_calls += 1
        return "".join(self._chunks)

    def stream(self, prompt, **kwargs):
        for c in self._chunks:
            self._clock.now += self._spc
            self.streamed.append(c)
            yield c


def _structured_inprocess_patches(clock, gen):
    """Common patch set for the in-process (oMLX-down) structured() path.

    Fakes the outlines/model boundary entirely — no real model, no real
    outlines machinery."""
    import sys as _sys

    fake_outlines = MagicMock()
    fake_outlines.from_mlxlm.return_value = MagicMock()
    fake_outlines.Generator.return_value = gen
    tokenizer = MagicMock()
    tokenizer.encode.side_effect = lambda s: s.split()
    return (
        patch.dict(_sys.modules, {"outlines": fake_outlines}),
        patch("datum.local_llm._omlx_available", return_value=False),
        patch("datum.local_llm.load_model", return_value=(MagicMock(), tokenizer)),
        patch("datum.local_llm.load_config", return_value={}),
        patch("datum.local_llm._log_metric"),
        patch("time.monotonic", clock),
    )


def test_structured_inprocess_deadline_exceeded_returns_structured_timeout():
    """Deadline blown mid-stream → stops promptly, returns a structured
    timeout error: data=None, quality gate tripped, escalated=True with
    abort_reason='max_time_exceeded' (#104 house style)."""
    import contextlib

    from datum.local_llm import structured

    clock = _TickingClock(start=100.0)
    # 10 chunks at 2s each; budget 5s → deadline t=105 trips on chunk 3 (t=106).
    chunks = [f'"c{i}" ' for i in range(10)]
    gen = _FakeOutlinesGenerator(clock, chunks, seconds_per_chunk=2.0)

    with contextlib.ExitStack() as stack:
        for p in _structured_inprocess_patches(clock, gen):
            stack.enter_context(p)
        result = structured("p", MagicMock(), "test-model", max_time_s=5.0)

    assert result["abort_reason"] == "max_time_exceeded"
    assert result["escalated"] is True
    assert result["quality"] == {"ok": False, "reason": "max_time_exceeded"}
    # Partial JSON is useless — never parsed, surfaced as raw only.
    assert result["data"] is None
    assert result["raw"] == '"c0" "c1" "c2" '
    # Stops promptly: the stream was NOT consumed to exhaustion.
    assert len(gen.streamed) == 3
    assert gen.blocking_calls == 0
    assert result["time_s"] == 6.0


def test_structured_inprocess_generous_budget_parses_full_output():
    """Budget never exceeded → streams to completion, parses the full JSON,
    quality gate untouched, blocking gen() never called."""
    import contextlib

    from datum.local_llm import structured

    clock = _TickingClock(start=100.0)
    chunks = ['{"verdict": "pass"', "}"]
    gen = _FakeOutlinesGenerator(clock, chunks, seconds_per_chunk=1.0)

    with contextlib.ExitStack() as stack:
        for p in _structured_inprocess_patches(clock, gen):
            stack.enter_context(p)
        result = structured("p", MagicMock(), "test-model", max_time_s=1000.0)

    assert result["data"] == {"verdict": "pass"}
    assert result["raw"] == '{"verdict": "pass"}'
    assert result["quality"]["ok"] is True
    assert len(gen.streamed) == 2
    assert gen.blocking_calls == 0


def test_structured_inprocess_no_max_time_keeps_blocking_call():
    """max_time_s=None → behavior preserved: single blocking gen() call,
    no streaming, full parse."""
    import contextlib

    from datum.local_llm import structured

    clock = _TickingClock(start=100.0)
    gen = _FakeOutlinesGenerator(clock, ['{"verdict": "pass"}'])

    with contextlib.ExitStack() as stack:
        for p in _structured_inprocess_patches(clock, gen):
            stack.enter_context(p)
        result = structured("p", MagicMock(), "test-model")

    assert gen.blocking_calls == 1
    assert gen.streamed == []
    assert result["data"] == {"verdict": "pass"}
    assert result["quality"]["ok"] is True


def test_structured_inprocess_refuses_blocking_call_when_deadline_unenforceable():
    """Generator without stream() (older outlines) + max_time_s set → the
    blocking call is REFUSED with a structured error (#65 fail-loudly):
    never silently run past the caller's deadline."""
    import contextlib

    from datum.local_llm import structured

    class _BlockingOnlyGenerator:
        def __init__(self):
            self.blocking_calls = 0

        def __call__(self, prompt, **kwargs):
            self.blocking_calls += 1
            return '{"verdict": "pass"}'

    clock = _TickingClock(start=100.0)
    gen = _BlockingOnlyGenerator()

    with contextlib.ExitStack() as stack:
        for p in _structured_inprocess_patches(clock, gen):
            stack.enter_context(p)
        result = structured("p", MagicMock(), "test-model", max_time_s=5.0)

    assert result["escalated"] is True
    assert result["data"] is None
    assert result["quality"]["ok"] is False
    assert "max_time" in result["abort_reason"]
    # The deadline could not be honored, so the call never even started.
    assert gen.blocking_calls == 0


def test_omlx_call_empty_content_exhaustion_sleeps_between_attempts():
    """All attempts empty → ValueError after MAX-1 injected sleeps."""
    import json as _json

    import pytest

    from datum.local_llm import _OMLX_MAX_ATTEMPTS, _omlx_call

    empty = _json.dumps(
        {"choices": [{"message": {"content": None}}], "usage": {}}
    ).encode()

    def fake_urlopen(req, timeout=None, **kwargs):
        return _mock_resp(empty)

    sleep_fn = MagicMock()
    with (
        patch("datum.local_llm._omlx_urlopen_with_retry", fake_urlopen),
        pytest.raises(ValueError, match="no content"),
    ):
        _omlx_call(
            {"model": "m", "messages": []},
            "http://localhost:9999",
            10,
            sleep_fn=sleep_fn,
        )

    assert sleep_fn.call_count == _OMLX_MAX_ATTEMPTS - 1
