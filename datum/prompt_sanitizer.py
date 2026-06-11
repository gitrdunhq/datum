"""Utility for sanitizing prompt text by removing special tokens."""

import hashlib
import json
import re
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
        "\ufeff",  # zero-width non-breaking space (BOM)
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


# ── Secret detection (#95) ───────────────────────────────────────────────
# Ordered pattern list — order is load-bearing because prefixes overlap:
# sk-ant- (anthropic) must match BEFORE generic sk- (openai); JWTs before
# Bearer headers so a Bearer JWT gets the more specific kind; the
# sensitive-assignment catch-all runs LAST so specific kinds win the value.
# Pattern-list idea ported from caliber-ai/ai-setup sanitize.ts (MIT);
# regexes written for Python `re`.
SECRET_PATTERNS: list[tuple[str, re.Pattern[str], str]] = [
    (
        "pem-private-key",
        re.compile(
            r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----"
            r".*?"
            r"-----END [A-Z0-9 ]*PRIVATE KEY-----",
            re.DOTALL,
        ),
        "[REDACTED:pem-private-key]",
    ),
    (
        "db-credentials",
        re.compile(
            r"\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp)"
            r"://[^\s:@/]+:[^\s@]+@"
        ),
        r"\1://[REDACTED:db-credentials]@",
    ),
    (
        "anthropic",
        re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{8,}"),
        "[REDACTED:anthropic]",
    ),
    (
        "openai",
        re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),
        "[REDACTED:openai]",
    ),
    (
        "aws-access-key",
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        "[REDACTED:aws-access-key]",
    ),
    (
        "github",
        re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"),
        "[REDACTED:github]",
    ),
    (
        "stripe",
        re.compile(r"\b(?:sk_live|sk_test|pk_live)_[A-Za-z0-9]{10,}"),
        "[REDACTED:stripe]",
    ),
    (
        "slack",
        re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}"),
        "[REDACTED:slack]",
    ),
    (
        "google-api-key",
        re.compile(r"\bAIza[0-9A-Za-z_\-]{35}"),
        "[REDACTED:google-api-key]",
    ),
    (
        "jwt",
        re.compile(r"\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+"),
        "[REDACTED:jwt]",
    ),
    (
        "bearer",
        re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/\-]{15,}=*"),
        "Bearer [REDACTED:bearer]",
    ),
    (
        # Catch-all: api_key=..., password=..., secret=..., token=... style
        # assignments. Key name preserved, value redacted. The value class
        # excludes "[" so already-redacted placeholders are never re-eaten.
        "sensitive-assignment",
        re.compile(
            r"(?i)\b([A-Za-z0-9_\-]*(?:api[_-]?key|secret|password|passwd|token))"
            r"(\s*[=:]\s*)"
            r"([\"']?)"
            r"[^\s\"'\[\],;]{4,}"
            r"(\3)"
        ),
        r"\1\2\3[REDACTED:sensitive-assignment]\4",
    ),
]


def strip_secrets(text: str) -> str:
    """Redact credential-shaped substrings with stable [REDACTED:<kind>] markers.

    Patterns are applied in SECRET_PATTERNS order (order matters for
    overlapping prefixes). Transcripts stay readable and tests can assert
    the redaction kind.
    """
    for _kind, pattern, replacement in SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


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
    with open(store_path, encoding="utf-8") as f:
        stored_data = json.load(f)

    stored_digest = stored_data.get("sha256")

    if stored_digest == digest:
        return (rules_text, False)

    raise ValueError(
        f"Rules file changed since pinning: {store_path}. Possible tampering detected."
    )
