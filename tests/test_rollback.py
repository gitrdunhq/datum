"""Tests for datum/rollback.py migrating off the live-cache .datum/state.json
onto the canonical datum.state accessor (SPEC Requirement 10, task-004).

Net-new per lane red_note: this file did not exist pre-migration. It must
assert the round-trip through datum.state.load_state()/save_state() and stay
RED until rollback.py's live state write goes through the canonical
accessor. The archival snapshot path (.datum/runs/<run_id>/state.json) is
explicitly out of scope for rewriting and is only exercised here read-only.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import datum.rollback as rollback_mod
import datum.state as state_mod


def _fake_git(monkeypatch, merge_sha: str, revert_sha: str) -> None:
    """Stub rollback_mod.git so no real subprocess/git-history calls happen."""

    def fake(*args: str, check: bool = True) -> SimpleNamespace:
        if len(args) >= 2 and args[0] == "merge-base" and args[1] == "--is-ancestor":
            return SimpleNamespace(returncode=0, stdout="", stderr="")
        if len(args) >= 2 and args[0] == "rev-parse" and args[1] == "HEAD":
            return SimpleNamespace(returncode=0, stdout=revert_sha + "\n", stderr="")
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(rollback_mod, "git", fake)


def _fake_gh(monkeypatch) -> None:
    """Stub rollback_mod.gh so no real PR-creation network call happens."""
    monkeypatch.setattr(
        rollback_mod,
        "gh",
        lambda *a, **k: SimpleNamespace(returncode=1, stdout="", stderr=""),
    )


def test_ac1_no_live_cache_state_file_constant():
    """AC1: rollback.py must not expose a live-cache STATE_FILE pointing at
    .datum/state.json. Any surviving Path constant on the module must point
    only at the archival runs directory."""
    offenders = {
        name: str(value)
        for name, value in vars(rollback_mod).items()
        if isinstance(value, Path) and str(value) == ".datum/state.json"
    }
    assert offenders == {}
    assert str(rollback_mod.RUNS_DIR) == ".datum/runs"


def test_ac2_rollback_live_state_round_trips_through_canonical_accessor(
    tmp_path, monkeypatch
):
    """AC2: the live state a rollback run produces must be readable back via
    datum.state.load_state() — not only via the legacy .datum/state.json
    write. Pre-migration this fails because the write lands only in the JSON
    cache file and load_state() (db-backed) sees nothing for a fresh DB."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    original_run_id = "epic-3-20260101-000000"
    merge_sha = "abc123deadbeef"
    revert_sha = "feed1234abcd"

    _fake_git(monkeypatch, merge_sha=merge_sha, revert_sha=revert_sha)
    _fake_gh(monkeypatch)
    monkeypatch.setattr(rollback_mod, "next_epic_number", lambda: 7)
    monkeypatch.setattr(
        rollback_mod,
        "load_closeout_data",
        lambda run_id: {
            "merge_sha": merge_sha,
            "git": {"pr_url": "https://example.invalid/pr/1"},
        },
    )
    monkeypatch.setattr(sys, "argv", ["rollback.py", "--run-id", original_run_id])

    rollback_mod.main()

    persisted = state_mod.load_state()
    assert persisted.get("rollback_of") == original_run_id
    assert persisted.get("current_phase") == "validate"
    assert persisted["run_id"].startswith("epic-7-rollback-")
    assert persisted["git"]["original_merge_sha"] == merge_sha
    assert persisted["git"]["revert_sha"] == revert_sha
    assert persisted["lanes"] == {}


def test_ac5_archival_snapshot_read_still_resolves_an_archived_run_and_feeds_live_state(
    tmp_path, monkeypatch
):
    """AC5: rollback.py must still resolve `.datum/runs/<run_id>/state.json`
    as the archival snapshot (unchanged, read-only), and the values it reads
    from there must show up in the live state reachable through the
    canonical accessor. Pre-migration this fails because the live write
    never lands in load_state()'s backing store."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    monkeypatch.setattr(rollback_mod, "RUNS_DIR", tmp_path / ".datum" / "runs")

    original_run_id = "epic-3-20260101-000000"
    archival_dir = tmp_path / ".datum" / "runs" / original_run_id
    archival_dir.mkdir(parents=True)
    merge_sha = "cafebabefeed"
    (archival_dir / "state.json").write_text(
        json.dumps(
            {"merge_sha": merge_sha, "git": {"pr_url": "https://example.invalid/pr/9"}}
        )
    )

    _fake_git(monkeypatch, merge_sha=merge_sha, revert_sha="1234567890ab")
    _fake_gh(monkeypatch)
    monkeypatch.setattr(rollback_mod, "next_epic_number", lambda: 4)
    monkeypatch.setattr(sys, "argv", ["rollback.py", "--run-id", original_run_id])

    rollback_mod.main()

    persisted = state_mod.load_state()
    assert persisted.get("rollback_of") == original_run_id
    assert persisted["git"]["original_merge_sha"] == merge_sha
