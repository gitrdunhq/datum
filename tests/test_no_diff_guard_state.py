"""Tests for datum/no_diff_guard.py migrating off its own inline
load_state/save_state onto the canonical datum.state accessor
(SPEC Requirement 10, task-004).

Net-new per lane red_note: save_state a fixture via the canonical accessor
and assert the guard sees it — proving the guard reads/writes through
datum.state rather than its own .datum/state.json read/write helpers.
"""

from __future__ import annotations

import json
import sys

import pytest

import datum.no_diff_guard as guard_mod
import datum.state as state_mod


def test_ac3_guard_defines_no_shadow_load_state_and_save_state():
    """AC3: no_diff_guard.py must not define its own load_state/save_state
    that shadow datum.state's — any surviving module attribute of that name
    must resolve to the exact canonical function object."""
    module_load_state = getattr(guard_mod, "load_state", None)
    module_save_state = getattr(guard_mod, "save_state", None)
    assert module_load_state in (None, state_mod.load_state)
    assert module_save_state in (None, state_mod.save_state)


def test_ac4_guard_reads_state_seeded_via_canonical_accessor_and_persists_back_through_it(
    tmp_path, monkeypatch, capsys
):
    """AC4: the guard's pass/block decision for a given state dict must be
    unchanged, but it must read that dict (and write its updated count)
    through datum.state, not its own file. Seed state only via
    state_mod.save_state (the canonical accessor); pre-migration the guard's
    own save_state() never updates the DB kv_state row, so the second read
    through state_mod.load_state() still shows the stale pre-seeded count."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    monkeypatch.setattr(guard_mod, "git_diff_stat", lambda *a, **k: 0)

    state_mod.save_state(
        {"lanes": {"task-004": {"stages": {"GREEN": {"consecutive_no_diff": 1}}}}}
    )

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "no_diff_guard.py",
            "--lane",
            "task-004",
            "--stage",
            "GREEN",
            "--run-id",
            "run-1",
            "--before-sha",
            "aaa",
            "--after-sha",
            "bbb",
        ],
    )

    with pytest.raises(SystemExit) as excinfo:
        guard_mod.main()
    assert excinfo.value.code == 1

    out = json.loads(capsys.readouterr().out)
    assert out["stall"] is True
    assert out["consecutive_no_diff"] == 2

    persisted = state_mod.load_state()
    stage_data = persisted["lanes"]["task-004"]["stages"]["GREEN"]
    assert stage_data["consecutive_no_diff"] == 2


def test_ac4_negative_a_real_diff_clears_the_no_diff_counter_via_canonical_accessor(
    tmp_path, monkeypatch, capsys
):
    """Negative/pass path for AC4: when a real diff exists the counter must
    be cleared, and that clearing must be observable through the canonical
    accessor (not just the guard's own read)."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    monkeypatch.setattr(guard_mod, "git_diff_stat", lambda *a, **k: 42)

    state_mod.save_state(
        {"lanes": {"task-004": {"stages": {"GREEN": {"consecutive_no_diff": 1}}}}}
    )

    monkeypatch.setattr(
        sys,
        "argv",
        [
            "no_diff_guard.py",
            "--lane",
            "task-004",
            "--stage",
            "GREEN",
            "--run-id",
            "run-1",
            "--before-sha",
            "ccc",
            "--after-sha",
            "ddd",
        ],
    )

    with pytest.raises(SystemExit) as excinfo:
        guard_mod.main()
    assert excinfo.value.code == 0

    out = json.loads(capsys.readouterr().out)
    assert out["stall"] is False
    assert out["changed_lines"] == 42

    persisted = state_mod.load_state()
    stage_data = persisted["lanes"]["task-004"]["stages"]["GREEN"]
    assert "consecutive_no_diff" not in stage_data
