"""task-INT-11: integration invariants covering task-004, task-011.

INV-10: the new equivalence/round-trip tests (`test_rollback.py`,
`test_pipeline_scheduler.py`) prove task-004's (`datum/rollback.py`) and
task-011's (`datum/pipeline_scheduler.py`) migrated modules produce
identical observable behavior through the same canonical accessor
(`datum.state.load_state()` / `datum.state.save_state()`).

This is an integration lane: these tests exercise already-merged code and
are expected to PASS. A failure here is a real finding about the migration
boundary, not a test to weaken.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

import datum.pipeline_scheduler as scheduler_mod
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


def _write_lane_plan(tmp_path, lane_plan: dict) -> None:
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir(parents=True, exist_ok=True)
    (datum_dir / "lane-plan.json").write_text(json.dumps(lane_plan))


def _run_next_ready(monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["pipeline_scheduler.py", "next-ready"])
    scheduler_mod.main()
    out = capsys.readouterr().out
    return json.loads(out)


def test_rollback_and_scheduler_bind_to_the_exact_same_canonical_accessor_functions():
    """INV-10: both migrated modules must resolve datum.state.load_state and
    datum.state.save_state to the exact same function objects -- never a
    module-local reimplementation that could silently diverge."""
    assert rollback_mod.state_mod.load_state is state_mod.load_state
    assert rollback_mod.state_mod.save_state is state_mod.save_state
    assert scheduler_mod.state_mod.load_state is state_mod.load_state

    # pipeline_scheduler only writes via the accessor for status reporting,
    # not saving state itself, but it must still delegate reads identically.
    assert not hasattr(scheduler_mod, "load_state")
    assert not hasattr(rollback_mod, "load_state")


def test_rollback_live_state_write_is_immediately_visible_to_scheduler_dispatch(
    tmp_path, monkeypatch, capsys
):
    """INV-10 round-trip: after datum/rollback.py writes fresh live state
    through the canonical accessor (a rollback run always starts with empty
    `lanes`), datum/pipeline_scheduler.py -- reading through that same
    accessor -- must dispatch a lane-plan's root lane exactly as it would
    for any other fresh/empty state. This proves the two migrated modules
    observe one single source of truth, not two independently-updated
    stores."""
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
    capsys.readouterr()  # discard rollback's own stdout before scheduler runs

    # Sanity: rollback really did land state through the canonical accessor.
    persisted = state_mod.load_state()
    assert persisted["lanes"] == {}
    assert persisted["rollback_of"] == original_run_id

    _write_lane_plan(tmp_path, {"lanes": {"task-x": {"depends_on": [], "files": []}}})

    result = _run_next_ready(monkeypatch, capsys)

    assert result == [{"lane_id": "task-x", "next_stage": "RED"}]


def test_rollback_error_path_and_scheduler_agree_on_untouched_canonical_state(
    tmp_path, monkeypatch, capsys
):
    """INV-10 negative path: when rollback.py aborts before ever writing
    state (no merge_sha resolvable for the given run), the canonical
    accessor must show exactly the same 'no state yet' result
    (load_state() == {}) that pipeline_scheduler.py already treats as its
    empty-state case -- proving the two modules agree on observable
    behavior even when task-004's migrated module takes its error branch
    and never calls save_state at all."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    _fake_git(monkeypatch, merge_sha="unused", revert_sha="unused")
    _fake_gh(monkeypatch)
    monkeypatch.setattr(rollback_mod, "load_closeout_data", lambda run_id: {})
    monkeypatch.setattr(
        sys, "argv", ["rollback.py", "--run-id", "epic-9-missing-merge-sha"]
    )

    with pytest.raises(SystemExit) as exc_info:
        rollback_mod.main()
    assert exc_info.value.code == 1
    capsys.readouterr()  # discard rollback's own stdout before scheduler runs

    assert state_mod.load_state() == {}

    _write_lane_plan(tmp_path, {"lanes": {"task-x": {"depends_on": [], "files": []}}})

    result = _run_next_ready(monkeypatch, capsys)

    assert result == [{"lane_id": "task-x", "next_stage": "RED"}]
