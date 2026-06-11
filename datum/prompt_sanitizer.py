"""Utility for sanitizing prompt text by removing special tokens."""

import re

# Construct all special tokens via string concatenation as required
TOKEN_IM_START = "<|" + "im_start" + "|>"
TOKEN_IM_END = "<|" + "im_end" + "|>"
TOKEN_ENDOFTEXT = "<|" + "endoftext" + "|>"
TOKEN_THINK_OPEN = "<" + "think" + ">"
TOKEN_THINK_CLOSE = "</" + "think" + ">"
TOKEN_SOT = "<" + "start_of_turn" + ">"
TOKEN_EOT = "<" + "end_of_turn" + ">"
TOKEN_BOS = "<" + "bos" + ">"
TOKEN_EOS = "<" + "eos" + ">"

# Build the list of tokens and compile the pattern
_TOKENS = (
    TOKEN_IM_START,
    TOKEN_IM_END,
    TOKEN_ENDOFTEXT,
    TOKEN_THINK_OPEN,
    TOKEN_THINK_CLOSE,
    TOKEN_SOT,
    TOKEN_EOT,
    TOKEN_BOS,
    TOKEN_EOS,
)

# Compile the regex pattern with escaped tokens
_PATTERN = re.compile("|".join(re.escape(t) for t in _TOKENS))


def strip_special_tokens(text: str) -> str:
    """Remove all special tokens from the input text."""
    return _PATTERN.sub("", text)
