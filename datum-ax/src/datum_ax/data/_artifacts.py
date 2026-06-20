"""Shared markdown-artifact loading for the file-backed registries (persona, rules).

One robust frontmatter parser + a per-file loader that **isolates a bad artifact** (logs and skips it)
instead of letting one malformed file abort the whole registry. Used by persona + rule registries so
the parsing/robustness logic lives in exactly one place.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, TypeVar

import yaml

from datum_ax.observability import get_logger

logger = get_logger(__name__)

T = TypeVar("T")


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split ``---\\n<yaml>\\n---\\n<body>`` into (metadata, body).

    Robust: a file with no real frontmatter (e.g. one that opens with a ``---`` horizontal rule) or
    whose frontmatter isn't a YAML mapping is treated as all-body — never a crash, never silent
    metadata loss.
    """
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) == 3:
            try:
                meta = yaml.safe_load(parts[1])
            except yaml.YAMLError:
                meta = None
            if isinstance(meta, dict):
                return meta, parts[2].strip()
    return {}, text.strip()


def load_artifacts(
    roots: Sequence[Path],
    build: Callable[[str, dict[str, Any], str], T],
) -> dict[str, T]:
    """Load ``*.md`` from each root (later roots override earlier on id collision), building each via
    ``build(stem, meta, body)``. A file that fails to parse/build is logged and skipped, so one bad
    artifact can't take down the registry.
    """
    out: dict[str, T] = {}
    for root in roots:
        for path in sorted(root.rglob("*.md")):
            try:
                meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
                out[path.stem] = build(path.stem, meta, body)
            except Exception as exc:  # malformed artifact — isolate it
                logger.warning("artifact_skipped", path=str(path), error=str(exc))
    return out
