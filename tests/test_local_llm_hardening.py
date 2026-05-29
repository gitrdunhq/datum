from unittest.mock import MagicMock, patch
from datum.local_llm import DEFAULTS, check_context_budget


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
