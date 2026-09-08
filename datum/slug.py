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
        unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    )
    hyphenated = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower())
    return hyphenated.strip("-")[:max_len].rstrip("-")


_LEADING_LABEL = re.compile(r"^\s*(?:\[[^\]]*\]\s*)+")
_PARENTHESISED = re.compile(r"\([^)]*\)")


def branch_slug_from_title(title: str, max_len: int = 40) -> str:
    """A branch/epic slug from an issue title (#521): a leading `[label]` is
    dropped, parenthesised fragments are dropped, and the slug is cut at a
    word boundary at or under *max_len* (a single overlong word is hard-cut).
    `[feature] Sequential repo-wide task numbers (DAT-123) instead of ...`
    -> `sequential-repo-wide-task-numbers`."""
    if not isinstance(title, str):
        raise TypeError("title must be a str")
    cleaned = _PARENTHESISED.sub(" ", _LEADING_LABEL.sub("", title))
    full = slugify(cleaned, max_len=max(len(cleaned), 1) + 1)
    if len(full) <= max_len:
        return full
    cut = full[:max_len]
    at_boundary = cut.rfind("-")
    return cut[:at_boundary] if at_boundary > 0 else cut


def make_unique(slug: str, existing) -> str:
    """Return slug unchanged if free, else slug-2, slug-3, ... until unique."""
    if slug not in existing:
        return slug
    n = 2
    while f"{slug}-{n}" in existing:
        n += 1
    return f"{slug}-{n}"
