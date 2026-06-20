"""G3 — a real tokenizer behind the TokenCounter port (ADR-0030/0034). Default to a real tokenizer
when the `[tokenizer]` extra is installed; degrade to the ~4-chars/token heuristic otherwise. The
crane uses whatever counter is injected, so budgets/pruning can become exact without code changes."""

from __future__ import annotations

import importlib.util

import pytest

from datum_ax.contracts.tokens import default_token_count
from datum_ax.presentation.composition import build_context_crane, build_token_counter

_HAS_TIKTOKEN = importlib.util.find_spec("tiktoken") is not None


def test_build_token_counter_is_a_callable_returning_positive_ints():
    counter = build_token_counter()
    assert callable(counter)
    assert counter("hello world") >= 1


def test_heuristic_is_used_when_tiktoken_absent():
    if _HAS_TIKTOKEN:
        pytest.skip("tiktoken installed — real tokenizer is the default")
    assert build_token_counter() is default_token_count


def test_explicit_heuristic_override():
    import os

    os.environ["DATUM_TOKENIZER"] = "heuristic"
    try:
        assert build_token_counter() is default_token_count
    finally:
        del os.environ["DATUM_TOKENIZER"]


def test_crane_uses_the_injected_counter():
    crane = build_context_crane()
    assert crane._count("abcd") >= 1  # crane counts via the injected tokenizer


@pytest.mark.skipif(not _HAS_TIKTOKEN, reason="tiktoken not installed")
def test_tiktoken_counter_when_available():
    from datum_ax.data.tokenizers import build_tiktoken_counter

    assert build_tiktoken_counter()("hello world") >= 1
