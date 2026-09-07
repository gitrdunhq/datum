"""Tests for datum/spec_drift_detector.py migrating off the live-cache
.datum/state.json onto the canonical datum.state accessor (task-005).

Net-new per lane red_note: this file did not exist pre-migration. It must
assert a drift flag written by write_drift_event() is durable via
datum.state.save_state/update_state and readable back through
datum.state.load_state() — not only via the module's own hand-rolled
tmp-file-and-replace write. spec_drift_detector has no discoverable
production launcher (a prior repo audit documents it as an orphan); it is
migrated per the SPEC's canonical-accessor requirement, not deleted.
"""

from __future__ import annotations

from pathlib import Path

import datum.spec_drift_detector as drift_mod
import datum.state as state_mod


def test_ac1_spec_drift_detector_has_no_local_state_file_constant():
    """AC1: spec_drift_detector.py must not expose a live STATE_FILE Path
    constant pointing at .datum/state.json (the pre-migration hand-rolled
    cache). Any surviving Path constant with that value is an offender."""
    offenders = {
        name: str(value)
        for name, value in vars(drift_mod).items()
        if isinstance(value, Path) and str(value) == ".datum/state.json"
    }
    assert offenders == {}


def test_ac4_write_drift_event_persists_readable_via_canonical_load_state(
    tmp_path, monkeypatch
):
    """AC4: a drift flag written by write_drift_event() must be readable
    back via datum.state.load_state() — the accessor's sqlite transaction
    now provides the durability the old tmp-file-and-replace guaranteed."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    drift_mod.write_drift_event(
        "run-9",
        "sha256:aaaaaaaaaaaaaaaa",
        "sha256:bbbbbbbbbbbbbbbb",
        "scoped",
        ["task-001"],
    )

    persisted = state_mod.load_state()
    events = persisted.get("spec_drift_events", [])
    assert len(events) == 1
    assert events[0]["old_hash"] == "sha256:aaaaaaaaaaaaaaaa"
    assert events[0]["new_hash"] == "sha256:bbbbbbbbbbbbbbbb"
    assert events[0]["impact"] == "scoped"
    assert events[0]["affected_lanes"] == ["task-001"]


def test_ac4_write_drift_event_preserves_existing_state_keys(tmp_path, monkeypatch):
    """AC4 (negative/merge path): write_drift_event must merge into the
    existing durable state (as update_state's transactional read-modify-
    write would), not clobber unrelated keys already persisted for the
    run. Deleting the write-through JSON cache after seeding proves the
    merge happens through the canonical accessor, not the legacy file."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    state_mod.save_state({"run_id": "run-9", "current_phase": "act"})
    (tmp_path / ".datum" / "state.json").unlink()

    drift_mod.write_drift_event(
        "run-9",
        "sha256:old1234567890ab",
        "sha256:new1234567890ab",
        "cross_cutting",
        [],
    )

    persisted = state_mod.load_state()
    assert persisted.get("run_id") == "run-9"
    assert persisted.get("current_phase") == "act"
    events = persisted.get("spec_drift_events", [])
    assert len(events) == 1
    assert events[0]["impact"] == "cross_cutting"


def test_ac5_spec_drift_detector_state_accessors_are_canonical_and_no_tmp_artifact(
    tmp_path, monkeypatch
):
    """AC5: no hand-rolled state serialisation left behind — a local
    load_state/save_state, if exposed at module scope at all, must be the
    canonical datum.state functions, and write_drift_event must not leave
    a local atomic-replace .tmp artifact behind. SPEC_FILE (unrelated to
    the state migration) must survive untouched."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

    local_load = getattr(drift_mod, "load_state", None)
    local_save = getattr(drift_mod, "save_state", None)
    assert local_load in (None, state_mod.load_state)
    assert local_save in (None, state_mod.save_state)

    drift_mod.write_drift_event(
        "run-5",
        "sha256:1111111111111111",
        "sha256:2222222222222222",
        "scoped",
        [],
    )

    assert not (tmp_path / ".datum" / "state.tmp").exists()
    assert str(drift_mod.SPEC_FILE) == "SPEC.md"
