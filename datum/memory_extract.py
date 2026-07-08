#!/usr/bin/env python3
"""Auto-extraction of memory candidates from session transcripts.

Input: one or more .jsonl session transcript paths
Greps for correction signals from user messages and extracts candidate memories.
Output: JSON with high/medium/low confidence candidate buckets.

High-confidence candidates (clear "remember X" or "always do Y") are suitable
for auto-write without confirmation. Medium/low should be presented to the user.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

CORRECTION_PATTERNS: list[tuple[str, str, str]] = [
    (r"\bdon.t\s+\w+", "feedback", "high"),
    (r"\bdo not\s+\w+", "feedback", "high"),
    (r"\balways\s+\w+", "feedback", "high"),
    (r"\bnever\s+\w+", "feedback", "high"),
    (r"\bstop\s+\w+", "feedback", "high"),
    (r"\bremember\b", "project", "high"),
    (r"\bno,\s", "feedback", "medium"),
    (r"\bwrong\b", "feedback", "medium"),
    (r"\bactually\b", "feedback", "medium"),
    (r"\bwe should\b", "feedback", "medium"),
    (r"\bwe need to\b", "project", "medium"),
]

CONTEXT_WINDOW = 200

# Substrings that mark a message as pipeline/tool noise (raw transcript or
# tool-call artifacts) rather than genuine user-authored content. Any message
# containing one of these is skipped outright before pattern matching — it
# should never surface as a memory candidate, at any confidence tier.
NOISE_MARKERS: tuple[str, ...] = (
    "<task-notification>",
    "<task-id>",
    "system-reminder",
    "Base directory skill:",
    "Tool loaded.",
)

# Regex patterns for noise that isn't a fixed substring (e.g. skill-invocation
# boilerplate that varies by skill name).
NOISE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'Run the ["“][\w-]+["”]\s+workflow', re.IGNORECASE),
)


def _is_noise(text: str) -> bool:
    """True if `text` looks like raw pipeline/tool-call noise, not user content."""
    if any(marker in text for marker in NOISE_MARKERS):
        return True
    return any(pattern.search(text) for pattern in NOISE_PATTERNS)


def _extract_from_transcript(transcript_path: Path) -> list[dict]:
    candidates: list[dict] = []
    seen: set[str] = set()

    with transcript_path.open(encoding="utf-8") as fh:
        for raw_line in fh:
            raw_line = raw_line.strip()
            if not raw_line:
                continue
            try:
                event = json.loads(raw_line)
            except json.JSONDecodeError:
                continue

            msg = event.get("message", {})
            if msg.get("role") not in ("human", "user"):
                continue

            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    c.get("text", "")
                    for c in content
                    if isinstance(c, dict) and c.get("type") == "text"
                )
            elif isinstance(content, str):
                text = content
            else:
                continue

            if not text.strip():
                continue

            if _is_noise(text):
                continue

            for pattern, suggested_type, confidence in CORRECTION_PATTERNS:
                if not re.search(pattern, text, re.IGNORECASE):
                    continue
                dedup_key = text[:80]
                if dedup_key in seen:
                    break
                seen.add(dedup_key)
                words = re.findall(r"\w+", text.lower())[:5]
                candidates.append(
                    {
                        "source_quote": text[:300],
                        "context_before": text[:CONTEXT_WINDOW],
                        "timestamp": event.get("timestamp", ""),
                        "suggested_type": suggested_type,
                        "suggested_name": "-".join(words),
                        "suggested_body": "",
                        "confidence": confidence,
                    }
                )
                break

    return candidates


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: memory_extract.py <transcript.jsonl> [...]", file=sys.stderr)
        sys.exit(1)

    all_candidates: list[dict] = []
    for path_arg in sys.argv[1:]:
        transcript_path = Path(path_arg).expanduser()
        if not transcript_path.is_file():
            print(f"File not found: {transcript_path}", file=sys.stderr)
            continue
        all_candidates.extend(_extract_from_transcript(transcript_path))

    output = {
        "total": len(all_candidates),
        "high_confidence": [c for c in all_candidates if c["confidence"] == "high"],
        "medium_confidence": [c for c in all_candidates if c["confidence"] == "medium"],
        "low_confidence": [c for c in all_candidates if c["confidence"] == "low"],
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
