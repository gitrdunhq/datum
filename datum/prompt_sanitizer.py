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


# Define invisible Unicode characters to strip
# - zero-width chars: U+200B to U+200D, and U+FEFF
# - bidi controls: U+202A to U+202E, and U+2066 to U+2069
# - private-use-area: U+E000 to U+F8FF
_INVISIBLE = re.compile(r"[\u200b-\u200d\ufeff\u202a-\u202e\u2066-\u2069\ue000-\uf8ff]")


def strip_invisible_unicode(text: str) -> str:
    """Remove all invisible Unicode characters from the input text.

    Strips:
    - zero-width characters U+200B through U+200D, and U+FEFF
    - bidi controls U+202A through U+202E, and U+2066 through U+2069
    - private-use-area characters U+E000 through U+F8FF

    Uses a single compiled regex with ASCII escape sequences only.
    """
    return _INVISIBLE.sub("", text)
