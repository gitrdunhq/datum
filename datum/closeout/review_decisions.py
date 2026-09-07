#!/usr/bin/env python3
"""Deterministic renderer/patcher for CURRENT_STATE.md's Review Decisions
section.

#460 — closeout wrote CURRENT_STATE.md once, during the pipeline, before the
operator had a chance to run `datum review-accept`. The rendered sentence
("no REVIEW-RESPONSE.md") was true at write time but read as a final verdict,
and stayed wrong forever once decisions were recorded afterwards — the
archived copy of CURRENT_STATE.md carried the stale sentence permanently.

This module is the single source of truth for that section's text. Two
callers use it: the initial closeout synthesis (which wraps the section in
the markers below so it can be found again), and `datum review-accept`,
which re-renders the section in place every time an ACCEPT/DEFER is
recorded, so the file always reflects what has actually been decided *as of
now* rather than what was known when the pipeline ran.

Conservative by design: this module only ever replaces text between its own
markers (or appends a fresh section) — it never touches any other part of
CURRENT_STATE.md, and it never creates the file (a missing CURRENT_STATE.md
means closeout hasn't run yet; review-accept has nothing to patch).
"""

from __future__ import annotations

import re
from pathlib import Path

SECTION_START = "<!-- review-decisions:start -->"
SECTION_END = "<!-- review-decisions:end -->"
HEADING = "## Review Decisions"

# True the moment REVIEW-RESPONSE.md doesn't exist (or has no decision lines
# yet) — deliberately provisional, never a final-sounding claim like "no
# REVIEW-RESPONSE.md" (#460).
ABSENT_SENTENCE = (
    "No review decisions recorded yet; `datum review-accept` will update this line."
)

_DECISION_LINE_RE = re.compile(r"^\s*[-*]?\s*(ACCEPT|DEFER)\b", re.IGNORECASE)


def render_review_decisions_body(review_response_path: Path) -> str:
    """The markdown body for the section: quoted ACCEPT/DEFER lines from
    REVIEW-RESPONSE.md verbatim, or ABSENT_SENTENCE when the file doesn't
    exist or has no decision lines yet."""
    if not review_response_path.exists():
        return ABSENT_SENTENCE
    lines = [
        ln
        for ln in review_response_path.read_text().splitlines()
        if _DECISION_LINE_RE.match(ln)
    ]
    if not lines:
        return ABSENT_SENTENCE
    return "\n".join(lines)


def render_review_decisions_section(review_response_path: Path) -> str:
    """The full marker-wrapped section, ready to append to or splice into
    CURRENT_STATE.md."""
    body = render_review_decisions_body(review_response_path)
    return f"{SECTION_START}\n{HEADING}\n\n{body}\n{SECTION_END}"


def upsert_review_decisions_section(
    current_state_path: Path, review_response_path: Path
) -> bool:
    """Patch CURRENT_STATE.md's Review Decisions section in place.

    Replaces the text between SECTION_START/SECTION_END if present, else
    appends a fresh section. Never creates CURRENT_STATE.md — returns False
    (no-op) when it doesn't exist yet, or when the computed section is
    already exactly what's on disk.
    """
    if not current_state_path.exists():
        return False
    text = current_state_path.read_text()
    section = render_review_decisions_section(review_response_path)
    if SECTION_START in text and SECTION_END in text:
        pattern = re.compile(
            re.escape(SECTION_START) + r".*?" + re.escape(SECTION_END), re.DOTALL
        )
        new_text = pattern.sub(section, text, count=1)
    else:
        new_text = text.rstrip("\n") + "\n\n" + section + "\n"
    if new_text == text:
        return False
    current_state_path.write_text(new_text)
    return True
