"""Utility for sanitizing prompt text by removing special tokens."""

import re
import hashlib
import json
from pathlib import Path

# Construct all special tokens via string concatenation as required
TOKEN_IM_START = "<|" + "im_start" + "|>"
TOKEN_IM_END = "<|" + "im_end" + "|>"
TOKEN_ENDOFTEXT = "<|" + "endoftext" + "|>"
TOKEN_THINK_OPEN = "<" + "think" + ">"
TOKEN_THINK_CLOSE = "</" + "think" + ">"
TOKEN_SOT = "<" + "start_of_turn" + ">"
TOKEN_EOT = "<" + "end_of_turn" + ">"
TOKEN_USER = "<" + "user" + ">"
TOKEN_ASSISTANT = "<" + "assistant" + ">"
TOKEN_BOS = "<" + "bos" + ">"
TOKEN_EOS = "<" + "eos" + ">"

# Common special tokens used in models
SPECIAL_TOKENS = [
    TOKEN_IM_START,
    TOKEN_IM_END,
    TOKEN_ENDOFTEXT,
    TOKEN_THINK_OPEN,
    TOKEN_THINK_CLOSE,
    TOKEN_SOT,
    TOKEN_EOT,
    TOKEN_USER,
    TOKEN_ASSISTANT,
    TOKEN_BOS,
    TOKEN_EOS,
]

# Regex pattern to match any special token
SPECIAL_TOKEN_REGEX = re.compile("|".join(re.escape(token) for token in SPECIAL_TOKENS))

def strip_special_tokens(text: str) -> str:
    """Remove all special tokens from the input text."""
    return SPECIAL_TOKEN_REGEX.sub("", text)

def strip_invisible_unicode(text: str) -> str:
    """Remove invisible Unicode characters (e.g., zero-width space, non-breaking space)."""
    # Create a translation table to remove invisible Unicode characters
    invisible_chars = {
        "\u200b",  # zero-width space
        "\u200c",  # zero-width non-joiner
        "\u200d",  # zero-width joiner
        "\u2060",  # word joiner
        "\uFEFF",  # zero-width non-breaking space (BOM)
        "\u202a",  # left-to-right embedding
        "\u202c",  # pop directional formatting
        "\u202d",  # right-to-left embedding
        "\u202e",  # left-to-right override
        "\u2066",  # left-to-right isolate
        "\u2067",  # right-to-left isolate
        "\u2068",  # first strong isolate
        "\u2069",  # pop directional isolate
        "\ue000",  # private use area start
        "\uf8ff",  # private use area end
    }
    # Create a translation table that maps each invisible char to None
    translator = str.maketrans("", "", "".join(invisible_chars))
    return text.translate(translator)


def hash_pin_rules(rules_text: str, store_path: Path) -> tuple[str, bool]:
    """Compute a hash of the rules text and pin it to disk.

    Args:
        rules_text: The raw rules string to hash.
        store_path: Path to a JSON file where the hash is stored.

    Returns:
        A tuple of (rules_text, has_changed):
            - rules_text: The input text unchanged.
            - has_changed: True if the file was written (new pin), False if the stored hash matched.

    Raises:
        ValueError: If the stored hash differs from the computed one, indicating possible tampering.
    """
    digest = hashlib.sha256(rules_text.encode("utf-8")).hexdigest()

    if not store_path.exists():
        # Write the new hash
        data = {"sha256": digest}
        with open(store_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        return (rules_text, True)

    # Load the stored hash
    with open(store_path, "r", encoding="utf-8") as f:
        stored_data = json.load(f)

    stored_digest = stored_data.get("sha256")

    if stored_digest == digest:
        return (rules_text, False)

    raise ValueError(
        f"Rules file changed since pinning: {store_path}. Possible tampering detected."
    )
