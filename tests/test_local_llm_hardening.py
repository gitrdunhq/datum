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
