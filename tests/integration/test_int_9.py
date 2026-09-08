"""task-INT-9: integration invariants covering task-002, task-003,
task-004, task-005, task-006, task-007, task-008, task-009, task-010,
task-011, task-012.

INV-1: The db-backed accessor (`load_state`/`save_state`/`update_state`)
is the single read/write path for live state across every migrated
module, with unchanged signatures.

INV-8: task-012's removal of the write-through cache is safe only
because every live-cache reader (task-002 through task-011) has already
migrated off `state.json`.

This is an integration lane: these tests exercise already-merged code and
are expected to PASS. A failure here is a real finding about the
migration boundary, not a test to weaken.
"""

from __future__ import annotations

import inspect
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import datum.closeout.archive as closeout_archive_mod
import datum.no_diff_guard as no_diff_guard_mod
import datum.pipeline_scheduler as scheduler_mod
import datum.pr_comment_monitor as pr_comment_monitor_mod
import datum.rollback as rollback_mod
import datum.spec_drift_detector as spec_drift_detector_mod
import datum.state as state_mod
import datum.status_render as status_render_mod

_DECOY_RUN_ID = "LEGACY-DECOY-DO-NOT-READ-INT9"
_DECOY_PHASE = "legacy-decoy-phase-int9"


def _seed_real_state_and_poison_json_cache(run_id: str, phase: str) -> None:
    """Write canonical state via save_state(), then overwrite the legacy
    write-through `.datum/state.json` cache with decoy values. Any reader
    that still performs a live literal read of `.datum/state.json` will
    observe the decoy values instead of (or in addition to) the
    canonical ones."""
    state_mod.save_state({"run_id": run_id, "current_phase": phase})
    Path(".datum").mkdir(parents=True, exist_ok=True)
    Path(".datum/state.json").write_text(
        json.dumps({"run_id": _DECOY_RUN_ID, "current_phase": _DECOY_PHASE})
    )


# --- INV-1 --------------------------------------------------------------


def test_accessor_signatures_are_unchanged_across_the_migration():
    """INV-1: load_state/save_state/update_state must retain their
    documented signatures -- no migrated module may rely on a shape that
    has silently changed underneath it."""
    assert str(inspect.signature(state_mod.load_state)) == "() -> dict"
    assert str(inspect.signature(state_mod.save_state)) == "(state: dict) -> None"
    assert (
        str(inspect.signature(state_mod.update_state))
        == "(mutator: <built-in function callable>) -> bool"
    )


def test_all_migrated_modules_bind_the_exact_same_canonical_accessor_objects():
    """INV-1: every migrated module must resolve load_state/save_state to
    the identical function objects defined on datum.state -- never a
    reimplementation that could silently diverge in behavior."""
    assert no_diff_guard_mod.load_state is state_mod.load_state
    assert no_diff_guard_mod.save_state is state_mod.save_state
    assert spec_drift_detector_mod.load_state is state_mod.load_state
    assert spec_drift_detector_mod.save_state is state_mod.save_state
    assert rollback_mod.state_mod.load_state is state_mod.load_state
    assert rollback_mod.state_mod.save_state is state_mod.save_state
    assert scheduler_mod.state_mod.load_state is state_mod.load_state
    assert closeout_archive_mod.load_state is state_mod.load_state


def test_save_state_no_longer_writes_the_legacy_state_json_write_through_cache(
    tmp_path, monkeypatch
):
    """INV-1 / task-012: save_state() is the single write path, and it
    must no longer perform a write-through to `.datum/state.json` at
    all -- the legacy cache file must not even be created."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state({"run_id": "epic-int9-1", "current_phase": "act"})

    assert not Path(".datum/state.json").exists()
    assert state_mod.load_state()["run_id"] == "epic-int9-1"


def test_update_state_round_trips_through_the_canonical_accessor_only(
    tmp_path, monkeypatch
):
    """INV-1: update_state() must mutate and persist through the same
    kv_state store load_state()/save_state() use, with zero write-through
    to state.json."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state({"run_id": "epic-int9-2", "counter": 0})

    def _bump(state):
        state["counter"] = state["counter"] + 1

    ok = state_mod.update_state(_bump)

    assert ok is True
    assert state_mod.load_state()["counter"] == 1
    assert not Path(".datum/state.json").exists()


# --- INV-8 ----------------------------------------------------------------


def test_no_diff_guard_never_surfaces_decoy_state_json_values(tmp_path, monkeypatch):
    """INV-8 (task-004): no_diff_guard.py must resolve state exclusively
    via datum.state.load_state(), never a live literal read of the
    legacy `.datum/state.json` write-through cache."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    _seed_real_state_and_poison_json_cache("epic-int9-guard", "validate")

    state = no_diff_guard_mod.load_state()

    assert state["run_id"] == "epic-int9-guard"
    assert state["current_phase"] == "validate"
    assert state["run_id"] != _DECOY_RUN_ID
    assert state["current_phase"] != _DECOY_PHASE


def test_spec_drift_detector_never_surfaces_decoy_state_json_values(
    tmp_path, monkeypatch
):
    """INV-8 (task-005): spec_drift_detector.py must resolve state
    exclusively via datum.state.load_state(), never a live literal read
    of `.datum/state.json`."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    _seed_real_state_and_poison_json_cache("epic-int9-drift", "triage")

    state = spec_drift_detector_mod.load_state()

    assert state["run_id"] == "epic-int9-drift"
    assert state["current_phase"] == "triage"
    assert state["run_id"] != _DECOY_RUN_ID
    assert state["current_phase"] != _DECOY_PHASE


def test_pr_comment_monitor_never_surfaces_decoy_state_json_values(
    tmp_path, monkeypatch
):
    """INV-8 (task-005): pr_comment_monitor.py must resolve state
    exclusively via datum.state.load_state(), never a live literal read
    of `.datum/state.json`."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    _seed_real_state_and_poison_json_cache("epic-int9-pr", "review")

    state = pr_comment_monitor_mod.load_state()

    assert state["run_id"] == "epic-int9-pr"
    assert state["current_phase"] == "review"
    assert state["run_id"] != _DECOY_RUN_ID
    assert state["current_phase"] != _DECOY_PHASE


def test_closeout_archive_snapshots_canonical_state_never_the_decoy_json(
    tmp_path, monkeypatch
):
    """INV-8 (task-009): closeout/archive.py must snapshot live state via
    datum.state.load_state() into the run archive -- never propagate the
    poisoned legacy `.datum/state.json` write-through cache values."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    _seed_real_state_and_poison_json_cache("epic-int9-archive", "closeout")

    monkeypatch.setattr(sys, "argv", ["archive.py", "--run-id", "epic-int9-archive"])
    closeout_archive_mod.main()

    archived = json.loads(Path(".datum/runs/epic-int9-archive/state.json").read_text())
    assert archived["run_id"] == "epic-int9-archive"
    assert archived["current_phase"] == "closeout"
    assert archived["run_id"] != _DECOY_RUN_ID
    assert archived["current_phase"] != _DECOY_PHASE
    # The legacy write-through cache in the live .datum/ dir must be gone
    # after archiving -- task-012's removal means there's nothing left to
    # clean up from a fresh save_state(), but any pre-existing decoy file
    # must still be swept away, never left to poison a future read.
    assert not Path(".datum/state.json").exists()


def test_status_render_never_surfaces_decoy_state_json_values(tmp_path, monkeypatch):
    """INV-8 (task-002): status_render.py must resolve state exclusively
    via datum.state.load_state(), never a live literal read of the
    legacy `.datum/state.json` write-through cache."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    _seed_real_state_and_poison_json_cache("epic-int9-render", "deepen")

    state = status_render_mod.load_state()

    assert state["run_id"] == "epic-int9-render"
    assert state["current_phase"] == "deepen"
    assert state["run_id"] != _DECOY_RUN_ID
    assert state["current_phase"] != _DECOY_PHASE


def test_rollback_and_scheduler_never_surface_decoy_state_json_values(
    tmp_path, monkeypatch, capsys
):
    """INV-8 (task-004, task-011): rollback.py and pipeline_scheduler.py
    must both resolve state exclusively via the canonical accessor,
    never the legacy `.datum/state.json` write-through cache."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")
    _seed_real_state_and_poison_json_cache("epic-int9-sched", "plan")

    def fake_git(*args: str, check: bool = True) -> SimpleNamespace:
        return SimpleNamespace(returncode=0, stdout="", stderr="")

    monkeypatch.setattr(rollback_mod, "git", fake_git)

    rollback_state = rollback_mod.state_mod.load_state()
    assert rollback_state["run_id"] == "epic-int9-sched"
    assert rollback_state["run_id"] != _DECOY_RUN_ID

    scheduler_state = scheduler_mod.state_mod.load_state()
    assert scheduler_state["run_id"] == "epic-int9-sched"
    assert scheduler_state["run_id"] != _DECOY_RUN_ID
