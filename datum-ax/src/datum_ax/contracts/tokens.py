"""Token counting — the single source of truth for estimating tokens (ADR-0030).

A boundary primitive both `core` and `data` import, so every layer estimates tokens the same way.
Inject a real tokenizer (e.g. tiktoken) where exactness matters; this heuristic (~4 chars/token) is
the default.
"""

from __future__ import annotations

from collections.abc import Callable

TokenCounter = Callable[[str], int]


def default_token_count(text: str) -> int:
    return max(1, len(text) // 4)
