"""Suite-wide test isolation fixtures.

Issue #103: tests that mock datum.agent_loop.time wholesale turn
time.strftime() into a MagicMock, and its repr became real filenames in the
repo's live .datum/transcripts/ ('<MagicMock name='time.strftime()' ...>
-act_red.jsonl'). Per-module chdir fixtures (issue #68) only protect their
own module; this conftest makes the isolation structural for the whole
suite: every test gets the transcript writer's base dir pointed at its own
tmp_path, so even a future test that forgets to chdir cannot write into
the live repo.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _isolate_transcript_writes(tmp_path, monkeypatch):
    """Redirect _TranscriptWriter.BASE_DIR to tmp_path for every test."""
    try:
        from datum.agent_loop import _TranscriptWriter
    except Exception:
        # If agent_loop can't import in this environment (e.g. missing
        # optional model deps), nothing can write transcripts either.
        return
    monkeypatch.setattr(
        _TranscriptWriter, "BASE_DIR", tmp_path / ".datum" / "transcripts"
    )
