"""Slug utilities: URL-safe slugs and collision-free naming."""

import re
import unicodedata


def slugify(text: str, max_len: int = 60) -> str:
    """Convert text to a lowercase ASCII hyphen-separated slug."""
    if not isinstance(text, str):
        raise TypeError("text must be a str")
    if max_len < 1:
        raise ValueError("max_len must be >= 1")
    ascii_text = (
        unicodedata.normalize("NFKD", text)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    hyphenated = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower())
    return hyphenated.strip("-")[:max_len].rstrip("-")


def make_unique(slug: str, existing) -> str:
    """Return slug unchanged if free, else slug-2, slug-3, ... until unique."""
    if slug not in existing:
        return slug
    n = 2
    while f"{slug}-{n}" in existing:
        n += 1
    return f"{slug}-{n}"
