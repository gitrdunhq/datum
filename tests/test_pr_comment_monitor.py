"""Tests for datum/pr_comment_monitor.py's run_id path handling.

Security: run_id builds a path via PROCESSED_FILE_TEMPLATE.format(run_id=...)
with no validation — a run_id containing '../' segments could escape
.datum/runs/. Not attacker-reachable today (run_id is an operator-supplied
CLI arg to the monitor daemon), but fixed for defense-in-depth consistency
with the other path-traversal fixes made this session.
"""

from __future__ import annotations

import pytest

from datum.pr_comment_monitor import load_processed, save_processed


def test_save_processed_rejects_path_traversal_run_id(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValueError):
        save_processed("../../../../../../tmp/evil", {"abc"})

    outside = tmp_path.parent.parent / "tmp" / "evil"
    assert not outside.exists()


def test_load_processed_rejects_path_traversal_run_id(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    with pytest.raises(ValueError):
        load_processed("../../../../../../tmp/evil")


def test_save_and_load_processed_round_trip(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    save_processed("run-1", {"a", "b"})
    assert load_processed("run-1") == {"a", "b"}
