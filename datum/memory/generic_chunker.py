"""GenericChunker — header-aware windowing for multiple content types.

Handles:
  - Markdown (split on ## / # headers, then window with overlap)
  - TOML specs (datum specs/*.toml — extracts [task]/[red]/[green]/[refactor] sections)
  - Plain text / transcripts / code files (fixed-window fallback)

Each chunk is returned as a (section_label, chunk_text) tuple.  Chunk ids
are computed as sha256(source:section:text)[:16] — the same idiom as
datum/memory/chunker.py:126-131 so id spaces are compatible.

The KnowledgeChunker (KNOWLEDGE.md format) is kept untouched; this module
adds the general corpus chunker for docs/specs/transcripts.

Design notes (from rag-corpus-context.md §2.3):
  - max_chars=1200, overlap=150 — fits under the 4000-char tool output cap
    while giving reasonable semantic coherence.
  - Section label format: "<source_label>#<section_header>" so retrieved
    chunks carry their provenance.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

_MARKDOWN_HEADER_RE = re.compile(r"^#{1,3}\s+(.+)", re.MULTILINE)
_TOML_SECTION_RE = re.compile(r"^\[([a-zA-Z0-9_.-]+)\]", re.MULTILINE)


@dataclass
class TextChunk:
    """A single chunk of text extracted from a corpus file."""

    text: str
    source: str  # file path or label
    section: str  # header / section label within the file
    chunk_id: str  # sha256(source:section:text)[:16]


def _make_chunk_id(source: str, section: str, text: str) -> str:
    """Deterministic 16-char id."""
    normalized = " ".join(text.split())
    raw = f"{source}:{section}:{normalized}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _window_text(
    text: str,
    section: str,
    source: str,
    max_chars: int,
    overlap: int,
) -> list[TextChunk]:
    """Split a block of text into overlapping windows.

    If the text fits within max_chars, returns a single chunk.
    Otherwise slides a window of max_chars with `overlap` chars of back-overlap.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [
            TextChunk(
                text=text,
                source=source,
                section=section,
                chunk_id=_make_chunk_id(source, section, text),
            )
        ]

    chunks: list[TextChunk] = []
    start = 0
    part = 0
    while start < len(text):
        end = start + max_chars
        chunk_text = text[start:end].strip()
        if chunk_text:
            label = f"{section}[{part}]" if part > 0 else section
            chunks.append(
                TextChunk(
                    text=chunk_text,
                    source=source,
                    section=label,
                    chunk_id=_make_chunk_id(source, label, chunk_text),
                )
            )
        part += 1
        start = end - overlap
        if start >= len(text):
            break
    return chunks


def _chunk_markdown(
    text: str,
    source: str,
    max_chars: int,
    overlap: int,
) -> list[TextChunk]:
    """Split markdown on ## / # headers, window each section."""
    # Find all header positions.
    headers = list(_MARKDOWN_HEADER_RE.finditer(text))
    if not headers:
        return _window_text(text, "body", source, max_chars, overlap)

    chunks: list[TextChunk] = []
    for i, match in enumerate(headers):
        section_label = match.group(1).strip()
        body_start = match.end()
        body_end = headers[i + 1].start() if i + 1 < len(headers) else len(text)
        section_text = text[body_start:body_end].strip()
        if section_text:
            chunks.extend(
                _window_text(section_text, section_label, source, max_chars, overlap)
            )

    # Preamble before the first header.
    preamble = text[: headers[0].start()].strip()
    if preamble:
        chunks[:0] = _window_text(preamble, "preamble", source, max_chars, overlap)

    return chunks


def _chunk_toml(
    text: str,
    source: str,
    max_chars: int,
    overlap: int,
) -> list[TextChunk]:
    """Split TOML by [section] headers, window each block."""
    matches = list(_TOML_SECTION_RE.finditer(text))
    if not matches:
        return _window_text(text, "body", source, max_chars, overlap)

    chunks: list[TextChunk] = []
    for i, match in enumerate(matches):
        section_label = match.group(1).strip()
        body_start = match.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        section_text = text[body_start:body_end].strip()
        if section_text:
            chunks.extend(
                _window_text(section_text, section_label, source, max_chars, overlap)
            )

    # Content before the first [section].
    preamble = text[: matches[0].start()].strip()
    if preamble:
        chunks[:0] = _window_text(preamble, "preamble", source, max_chars, overlap)

    return chunks


class GenericChunker:
    """Multi-format chunker for the datum corpus.

    Dispatches on file extension:
      .md         → markdown header-aware split
      .toml       → TOML section split
      everything  → fixed-window fallback

    The KnowledgeChunker (KNOWLEDGE.md reviewer format) handles its own
    parsing; this class is for general corpus files.

    Args:
        max_chars: Maximum characters per chunk window (default 1200).
        overlap:   Overlap between consecutive windows in chars (default 150).
    """

    def __init__(self, max_chars: int = 1200, overlap: int = 150) -> None:
        if max_chars <= 0:
            raise ValueError(f"max_chars must be positive, got {max_chars}")
        if overlap < 0:
            raise ValueError(f"overlap must be non-negative, got {overlap}")
        if overlap >= max_chars:
            raise ValueError(
                f"overlap ({overlap}) must be less than max_chars ({max_chars})"
            )
        self._max_chars = max_chars
        self._overlap = overlap

    def chunk(
        self, text: str, source: str, content_type: str | None = None
    ) -> list[TextChunk]:
        """Chunk arbitrary text.

        Args:
            text:         Raw content to chunk.
            source:       Label or file path (used in chunk_id and section prefix).
            content_type: One of "markdown", "toml", "text".  If None, inferred
                          from the source extension.

        Returns:
            List of TextChunk objects.
        """
        if not text or not text.strip():
            return []

        resolved_type = content_type or _infer_type(source)

        if resolved_type == "markdown":
            return _chunk_markdown(text, source, self._max_chars, self._overlap)
        if resolved_type == "toml":
            return _chunk_toml(text, source, self._max_chars, self._overlap)
        # Default: plain-text windowing.
        return _window_text(text, "body", source, self._max_chars, self._overlap)

    def chunk_file(
        self, path: Path, source_label: str | None = None
    ) -> list[TextChunk]:
        """Read a file from disk and chunk it.

        Args:
            path:         Absolute path to the file.
            source_label: Override for the source label (default: str(path)).

        Returns:
            List of TextChunk objects.  Empty if file is unreadable.
        """
        label = source_label or str(path)
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
        return self.chunk(text, label)


def _infer_type(source: str) -> str:
    """Infer content type from the source label / file extension."""
    lower = source.lower()
    if lower.endswith(".md") or lower.endswith(".markdown"):
        return "markdown"
    if lower.endswith(".toml"):
        return "toml"
    return "text"
