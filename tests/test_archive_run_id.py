"""RED (task-003): archive.py must derive run_id from the canonical
datum.state.load_state() accessor, never from a bare .datum/state.json
Path read (and never via datum.path_utils.current_run_id() — task-006
deletes that function).

See docs/epics/datum/state-single-source-of-truth/lane-plan.json, task-003.
"""

import json
import sys
from pathlib import Path

import pytest

import datum.archive as archive_mod
import datum.state as state_mod


def test_archive_derives_run_id_from_canonical_state_not_stale_json_cache(
    tmp_path, monkeypatch
):
    """AC: archive.py derives run_id from datum.state.load_state() when no
    --run-id is passed, and still writes its snapshot to
    .datum/runs/<run_id>/state.json."""
    monkeypatch.chdir(tmp_path)
    state_mod.save_state({"run_id": "db-run"})
    # Make the write-through JSON cache diverge from the canonical store —
    # archive.py must resolve run_id via datum.state.load_state(), never by
    # reading this file directly.
    Path(".datum/state.json").write_text(json.dumps({"run_id": "json-run"}))

    monkeypatch.setitem(archive_mod.PHASE_ARTIFACTS, "snapshot", [".datum/state.json"])
    monkeypatch.setattr(sys, "argv", ["archive.py", "--phase", "snapshot"])

    archive_mod.main()

    snapshot = Path(".datum/runs/db-run/state.json")
    assert snapshot.exists(), "expected run_id resolved via load_state() (db-run)"
    assert json.loads(snapshot.read_text()) == {"run_id": "json-run"}
    assert not Path(".datum/runs/json-run").exists()


def test_archive_resolves_run_id_when_json_cache_absent(tmp_path, monkeypatch, capsys):
    """AC: archive.py still resolves run_id from state even when the legacy
    write-through JSON cache is missing (the canonical accessor is the
    source of truth, not the cache file)."""
    monkeypatch.chdir(tmp_path)
    state_mod.save_state({"run_id": "z9"})
    Path(".datum/state.json").unlink()

    monkeypatch.setattr(sys, "argv", ["archive.py"])

    archive_mod.main()

    out = json.loads(capsys.readouterr().out)
    assert out == {"ok": True, "archived": [], "message": "Nothing to archive"}


def test_archive_errors_when_canonical_state_has_no_run_id(
    tmp_path, monkeypatch, capsys
):
    """AC: archive.py prints the JSON error object (or an updated equivalent
    message) when load_state() returns {} or has no run_id key — even if a
    stale legacy JSON cache still claims one."""
    monkeypatch.chdir(tmp_path)
    db_path = Path(".datum/state.db")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    db_path.touch()  # zero-byte: load_state() returns {}

    # A stale write-through cache still claims a run_id — archive.py must
    # not trust it once it derives run_id from datum.state.load_state().
    Path(".datum/state.json").write_text(
        json.dumps({"run_id": "stale-should-be-ignored"})
    )

    monkeypatch.setattr(sys, "argv", ["archive.py"])

    with pytest.raises(SystemExit) as excinfo:
        archive_mod.main()

    assert excinfo.value.code == 1
    out = json.loads(capsys.readouterr().out)
    assert "error" in out
    assert "run_id" in out["error"].lower().replace(" ", "_")
