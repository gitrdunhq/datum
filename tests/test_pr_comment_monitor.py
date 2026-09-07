"""Tests for datum/pr_comment_monitor.py's run_id path handling.

Security: run_id builds a path via PROCESSED_FILE_TEMPLATE.format(run_id=...)
with no validation — a run_id containing '../' segments could escape
.datum/runs/. Not attacker-reachable today (run_id is an operator-supplied
CLI arg to the monitor daemon), but fixed for defense-in-depth consistency
with the other path-traversal fixes made this session.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import datum.pr_comment_monitor as pr_monitor_mod
import datum.state as state_mod
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


# --- task-005: migration onto the canonical datum.state accessor -----------
#
# Build-order: task-005 depends on task-004 (datum/rollback.py's migration).
# These tests assert pr_comment_monitor.py resolves live pipeline state
# (git.pr_url / git.pr_author_login) through datum.state.load_state()
# rather than its own hand-rolled `.datum/state.json` read/write.


def test_ac1_pr_comment_monitor_has_no_local_state_file_constant():
    """AC1: pr_comment_monitor.py must not expose a live STATE_FILE Path
    constant pointing at .datum/state.json (the pre-migration hand-rolled
    cache). Any surviving Path constant with that value is an offender."""
    offenders = {
        name: str(value)
        for name, value in vars(pr_monitor_mod).items()
        if isinstance(value, Path) and str(value) == ".datum/state.json"
    }
    assert offenders == {}


def test_ac2_poll_once_reads_pr_url_via_canonical_state_accessor(tmp_path, monkeypatch):
    """AC2: poll_once must resolve pr_url/pr_author_login through
    datum.state.load_state() (db-backed), not a hand-rolled JSON read.
    Deleting the write-through JSON cache after seeding proves the read
    path this test depends on is the canonical accessor, not the legacy
    file — pre-migration poll_once sees an empty state and returns []."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state(
        {
            "run_id": "run-42",
            "current_phase": "act",
            "git": {
                "pr_url": "https://example.invalid/pr/1",
                "pr_author_login": "alice",
            },
        }
    )
    # amended: test_ac2_poll_once_reads_pr_url_via_canonical_state_accessor — superseded by AC1
    # save_state() no longer writes the legacy JSON cache at all (AC1), so the
    # file is unconditionally absent; unlink(missing_ok=True) tolerates that.
    (tmp_path / ".datum" / "state.json").unlink(missing_ok=True)

    monkeypatch.setattr(
        pr_monitor_mod,
        "fetch_pr_comments",
        lambda pr_url: [
            {"id": "1", "author": "alice", "body": "/datum status", "created_at": ""},
            {"id": "2", "author": "bob", "body": "/datum status", "created_at": ""},
        ],
    )
    monkeypatch.setattr(pr_monitor_mod, "post_reply", lambda *a, **k: None)

    actions = pr_monitor_mod.poll_once("run-42", reply_enabled=False)

    assert len(actions) == 1
    assert actions[0]["comment_id"] == "1"
    assert actions[0]["author"] == "alice"


def test_ac3_poll_once_preserves_trust_boundary_behavior_via_canonical_state(
    tmp_path, monkeypatch
):
    """AC3: same observable trust-boundary behaviour after migration — the
    fixture seeds state via datum.state.save_state instead of writing
    .datum/state.json directly. A non-author comment must be rejected,
    receive an acknowledgement reply, and be marked processed, exactly as
    before migration."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state(
        {
            "git": {
                "pr_url": "https://example.invalid/pr/9",
                "pr_author_login": "carol",
            }
        }
    )
    # amended: test_ac3_poll_once_preserves_trust_boundary_behavior_via_canonical_state — superseded by AC1
    # save_state() no longer writes the legacy JSON cache at all (AC1), so the
    # file is unconditionally absent; unlink(missing_ok=True) tolerates that.
    (tmp_path / ".datum" / "state.json").unlink(missing_ok=True)

    replies = []
    monkeypatch.setattr(
        pr_monitor_mod,
        "fetch_pr_comments",
        lambda pr_url: [
            {
                "id": "10",
                "author": "mallory",
                "body": "/datum rollback",
                "created_at": "",
            },
        ],
    )
    monkeypatch.setattr(pr_monitor_mod, "post_reply", lambda *a, **k: replies.append(a))

    actions = pr_monitor_mod.poll_once("run-99", reply_enabled=True)

    assert actions == []
    assert len(replies) == 1
    assert "accepted only from the PR author" in replies[0][2]

    processed = pr_monitor_mod.load_processed("run-99")
    assert processed == {"10"}


def test_ac5_pr_comment_monitor_state_accessors_are_canonical(tmp_path, monkeypatch):
    """AC5: no hand-rolled state serialisation left behind — a local
    load_state/save_state, if exposed at module scope at all, must be the
    canonical datum.state functions (not a re-implementation using json
    directly), and poll_once must not leave a local atomic-replace .tmp
    artifact behind."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    local_load = getattr(pr_monitor_mod, "load_state", None)
    local_save = getattr(pr_monitor_mod, "save_state", None)
    assert local_load in (None, state_mod.load_state)
    assert local_save in (None, state_mod.save_state)

    state_mod.save_state(
        {
            "git": {
                "pr_url": "https://example.invalid/pr/2",
                "pr_author_login": "dee",
            }
        }
    )
    monkeypatch.setattr(pr_monitor_mod, "fetch_pr_comments", lambda pr_url: [])

    pr_monitor_mod.poll_once("run-tmp", reply_enabled=False)

    assert not (tmp_path / ".datum" / "state.tmp").exists()
