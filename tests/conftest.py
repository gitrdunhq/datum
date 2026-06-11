"""Suite-wide test isolation fixtures.

Issue #103: tests that mock datum.agent_loop.time wholesale turn
time.strftime() into a MagicMock, and its repr became real filenames in the
repo's live .datum/transcripts/ ('<MagicMock name='time.strftime()' ...>
-act_red.jsonl'). Per-module chdir fixtures (issue #68) only protect their
own module; this conftest makes the isolation structural for the whole
suite: every test gets the transcript writer's base dir pointed at its own
tmp_path, so even a future test that forgets to chdir cannot write into
the live repo.

Issue #107: same leak class for the local-LLM metrics writer — test runs
that exercise generate()/structured()/multi-turn paths appended to the
repo's live .datum/local-llm-metrics.jsonl. Every test gets
datum.local_llm.METRICS_PATH pointed at its own tmp_path too.
"""

from __future__ import annotations

import pytest


@pytest.fixture(autouse=True)
def _force_offline_model_hubs(monkeypatch):
    """Tests must never download models — fail fast instead of fetching.

    Defensive guard for datum/memory tests (and anything else that could
    touch huggingface): embedding backends are simulated in tests, but if
    one ever slips through, these flags turn a silent multi-GB download
    into an immediate offline error.
    """
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("TRANSFORMERS_OFFLINE", "1")


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


@pytest.fixture(autouse=True)
def _isolate_local_llm_metrics(tmp_path, monkeypatch):
    """Redirect datum.local_llm.METRICS_PATH to tmp_path for every test."""
    try:
        from datum import local_llm
    except Exception:
        # If local_llm can't import in this environment, nothing can write
        # metrics either.
        return
    monkeypatch.setattr(
        local_llm, "METRICS_PATH", tmp_path / ".datum" / "local-llm-metrics.jsonl"
    )
