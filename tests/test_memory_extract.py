"""Tests for datum.memory_extract — the regex-based memory extraction fallback.

Covers issue #304: raw transcript/tool-call noise (task-notification XML tags,
skill-invocation boilerplate) must never surface as memory candidates, even
though it can incidentally match a correction pattern like "we need to".
"""

from __future__ import annotations

import json
from pathlib import Path

from datum.memory_extract import _extract_from_transcript


def _write_transcript(tmp_path: Path, messages: list[str]) -> Path:
    transcript_path = tmp_path / "transcript.jsonl"
    lines = []
    for i, text in enumerate(messages):
        lines.append(
            json.dumps(
                {
                    "timestamp": f"2026-01-0{i + 1}T00:00:00Z",
                    "message": {"role": "user", "content": text},
                }
            )
        )
    transcript_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return transcript_path


def test_extracts_genuine_correction(tmp_path: Path) -> None:
    transcript_path = _write_transcript(
        tmp_path, ["Never use /tmp for scratch files, always use .temp/ instead."]
    )
    candidates = _extract_from_transcript(transcript_path)
    assert len(candidates) == 1
    assert candidates[0]["confidence"] == "high"


def test_filters_task_notification_noise(tmp_path: Path) -> None:
    noisy = (
        'Run the "datum-plan" workflow.\n\n'
        "Decompose SPEC.md into tasks.json + lane-plan.json — approach, impact.\n"
        "   <task-notification>\n<task-id>wtbpsbd6o</task-id>\n"
        "we need to finish this task\n"
    )
    transcript_path = _write_transcript(tmp_path, [noisy])
    candidates = _extract_from_transcript(transcript_path)
    assert candidates == []


def test_filters_skill_invocation_boilerplate_even_without_tags(tmp_path: Path) -> None:
    noisy = 'Run the "datum-refine" workflow. We need to tighten the spec.'
    transcript_path = _write_transcript(tmp_path, [noisy])
    candidates = _extract_from_transcript(transcript_path)
    assert candidates == []


def test_filters_system_reminder_noise(tmp_path: Path) -> None:
    noisy = "<system-reminder>Always remember this internal note.</system-reminder>"
    transcript_path = _write_transcript(tmp_path, [noisy])
    candidates = _extract_from_transcript(transcript_path)
    assert candidates == []


def test_does_not_filter_legit_message_mentioning_workflow_word(tmp_path: Path) -> None:
    transcript_path = _write_transcript(
        tmp_path, ["Actually, we should never run that workflow script by hand again."]
    )
    candidates = _extract_from_transcript(transcript_path)
    assert len(candidates) == 1
