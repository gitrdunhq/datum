"""Real tokenizers behind the `TokenCounter` port (ADR-0030). `tiktoken` is an optional extra
(`datum-ax[tokenizer]`), imported lazily; the composition root falls back to the heuristic when it
isn't installed (or its encoding can't load). Same default-with-fallback shape as the semantic extra.
"""

from __future__ import annotations

from datum_ax.contracts.tokens import TokenCounter


def build_tiktoken_counter(encoding_name: str = "cl100k_base") -> TokenCounter:
    """A real BPE token counter. Raises if `tiktoken` (or its encoding) is unavailable — the caller
    degrades to the heuristic."""
    import tiktoken

    encoding = tiktoken.get_encoding(encoding_name)

    def count(text: str) -> int:
        return max(1, len(encoding.encode(text)))

    return count
