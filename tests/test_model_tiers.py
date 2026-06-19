"""Tests for get_model_for_phase two-tier model routing and KV cache config."""

import pytest
from unittest.mock import MagicMock, patch

from datum.local_llm import DEFAULTS, get_model_for_phase

_mlx_lm_available = True
try:
    import mlx_lm  # noqa: F401
except ImportError:
    _mlx_lm_available = False

_TWO_TIER_CONFIG = {
    "enabled": True,
    "model": "mlx-community/Qwen3-30B-A3B-4bit",
    "fast_model": "mlx-community/Llama-3.1-8B-Instruct-4bit",
    "fast_phases": ["triage", "validate"],
    "phases": ["triage", "act_red", "act_green", "validate"],
    "kv_bits": 8,
    "kv_group_size": 64,
    "max_kv_size": 32768,
}

_SINGLE_MODEL_CONFIG = {
    "enabled": True,
    "model": "mlx-community/gemma-4-26b-a4b-it-4bit",
    "phases": ["triage", "act_red"],
}


# ── Model tier routing ────────────────────────────────────────────────────────


def test_fast_phase_returns_fast_model():
    with patch("datum.local_llm.load_config", return_value=_TWO_TIER_CONFIG):
        assert (
            get_model_for_phase("triage") == "mlx-community/Llama-3.1-8B-Instruct-4bit"
        )
        assert (
            get_model_for_phase("validate")
            == "mlx-community/Llama-3.1-8B-Instruct-4bit"
        )


def test_quality_phase_returns_main_model():
    with patch("datum.local_llm.load_config", return_value=_TWO_TIER_CONFIG):
        assert get_model_for_phase("act_red") == "mlx-community/Qwen3-30B-A3B-4bit"
        assert get_model_for_phase("act_green") == "mlx-community/Qwen3-30B-A3B-4bit"
        assert get_model_for_phase("sidecar_docs") == "mlx-community/Qwen3-30B-A3B-4bit"


def test_no_fast_model_falls_back_to_main():
    with patch("datum.local_llm.load_config", return_value=_SINGLE_MODEL_CONFIG):
        assert get_model_for_phase("triage") == "mlx-community/gemma-4-26b-a4b-it-4bit"


def test_fast_model_none_falls_back_to_main():
    config = {**_TWO_TIER_CONFIG, "fast_model": None}
    with patch("datum.local_llm.load_config", return_value=config):
        assert get_model_for_phase("triage") == "mlx-community/Qwen3-30B-A3B-4bit"


def test_unknown_phase_returns_main_model():
    with patch("datum.local_llm.load_config", return_value=_TWO_TIER_CONFIG):
        assert (
            get_model_for_phase("some_future_phase")
            == "mlx-community/Qwen3-30B-A3B-4bit"
        )


def test_custom_fast_phases_override():
    config = {**_TWO_TIER_CONFIG, "fast_phases": ["act_skeleton"]}
    with patch("datum.local_llm.load_config", return_value=config):
        assert (
            get_model_for_phase("act_skeleton")
            == "mlx-community/Llama-3.1-8B-Instruct-4bit"
        )
        assert get_model_for_phase("triage") == "mlx-community/Qwen3-30B-A3B-4bit"


# ── KV cache defaults ─────────────────────────────────────────────────────────


def test_kv_defaults_are_set():
    assert DEFAULTS["kv_bits"] == 8
    assert DEFAULTS["kv_group_size"] == 64
    assert DEFAULTS["max_kv_size"] == 32768


@pytest.mark.skipif(not _mlx_lm_available, reason="mlx_lm not installed")
def test_kv_bits_none_disables_quantization():
    # When kv_bits is None no kv_bits/kv_group_size kwargs should reach stream_generate.
    config = {**_TWO_TIER_CONFIG, "kv_bits": None, "max_kv_size": None}
    mock_stream = MagicMock(return_value=iter([]))

    with (
        patch("datum.local_llm.load_config", return_value=config),
        patch("datum.local_llm.load_model", return_value=(MagicMock(), MagicMock())),
        patch(
            "datum.local_llm.check_context_budget",
            return_value={"fits": True, "prompt_tokens": 10, "window": 131072},
        ),
        patch("mlx_lm.stream_generate", mock_stream),
    ):
        from datum.local_llm import generate

        generate("hello", model_id="test-model")

    _, kwargs = mock_stream.call_args
    assert "kv_bits" not in kwargs
    assert "max_kv_size" not in kwargs


@pytest.mark.skipif(not _mlx_lm_available, reason="mlx_lm not installed")
def test_kv_kwargs_passed_to_stream_generate():
    # When kv_bits and max_kv_size are set they must reach stream_generate.
    mock_stream = MagicMock(return_value=iter([]))

    with (
        patch("datum.local_llm.load_config", return_value=_TWO_TIER_CONFIG),
        patch("datum.local_llm.load_model", return_value=(MagicMock(), MagicMock())),
        patch(
            "datum.local_llm.check_context_budget",
            return_value={"fits": True, "prompt_tokens": 10, "window": 131072},
        ),
        patch("mlx_lm.stream_generate", mock_stream),
    ):
        from datum.local_llm import generate

        generate("hello", model_id="test-model")

    _, kwargs = mock_stream.call_args
    assert kwargs.get("kv_bits") == 8
    assert kwargs.get("kv_group_size") == 64
    assert kwargs.get("max_kv_size") == 32768
