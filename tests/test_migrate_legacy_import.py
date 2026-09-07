# Skeleton: task-007 AC1-AC5 — PROP-001..PROP-004
# RED agent: assertions filled in below (no NotImplementedError placeholders).
# Traceability: AC1 -> test_ac1_only_migrate_reads_legacy_state_json
#               AC2 -> test_ac2_legacy_reader_and_writer_are_renamed
#               AC3 -> test_ac3_cli_migrate_uses_renamed_symbols_and_exits_cleanly
#               AC4 -> test_ac4_migrate_path_lands_upgraded_state_in_state_db
#               AC5 -> test_ac5_migrate_state_and_migrate_wfc_directory_signatures_unchanged
"""Tests for the task-007 retargeting of datum/migrate.py into a one-shot
legacy .datum/state.json importer, per SPEC Requirement 3 option (b).

datum/migrate.py must stop being a general load/save module: `load_state`
and `save_state` as defined *in datum/migrate.py* must go away (the legacy
reader is renamed, the writer delegates to datum.state.save_state), and
datum/cli.py's `migrate` command must import the renamed symbols so that
migrated state lands in .datum/state.db, readable afterwards via
datum.state.load_state().
"""

import json

from typer.testing import CliRunner

import datum.migrate as migrate_mod
import datum.state as state_mod
from datum.cli import app

runner = CliRunner()


def test_ac1_only_migrate_reads_legacy_state_json(tmp_path, monkeypatch):
    """AC1: datum/migrate.py is the only module permitted to read a legacy
    .datum/state.json. With a legacy state.json present and no state.db,
    datum.state.load_state() must see nothing (it never reads state.json),
    while datum.migrate exposes a dedicated legacy reader that does.
    """
    monkeypatch.chdir(tmp_path)
    legacy_dir = tmp_path / ".datum"
    legacy_dir.mkdir()
    legacy_state = {"schema_version": "1.0.0", "skill_version": "0.0.1"}
    (legacy_dir / "state.json").write_text(json.dumps(legacy_state))

    # datum.state.load_state() only ever looks at state.db; with none
    # present it must return {} even though a legacy state.json exists.
    assert state_mod.load_state() == {}

    # datum.migrate must expose a dedicated legacy reader (renamed from
    # load_state) that is the one place permitted to read state.json.
    legacy_reader = migrate_mod.load_legacy_state
    assert legacy_reader() == legacy_state


def test_ac2_legacy_reader_and_writer_are_renamed(tmp_path, monkeypatch):
    """AC2: datum/migrate.py defines no `load_state`/`save_state` of its
    own. The legacy reader is renamed (e.g. load_legacy_state) and any
    save_state visible on datum.migrate must be the real writer delegated
    from datum.state, not a module-local reimplementation.
    """
    assert hasattr(migrate_mod, "load_legacy_state"), (
        "datum.migrate must expose a renamed legacy reader, e.g. " "load_legacy_state"
    )

    # If save_state is importable off datum.migrate at all, it must be the
    # exact function object delegated from datum.state -- never a
    # module-local reimplementation that writes straight back to
    # state.json.
    migrate_save = getattr(migrate_mod, "save_state", None)
    assert migrate_save is None or migrate_save is state_mod.save_state

    # If load_state is importable off datum.migrate at all, it must not be
    # a module-local reimplementation either -- it must be the state.py
    # loader itself.
    migrate_load = getattr(migrate_mod, "load_state", None)
    assert migrate_load is None or migrate_load is state_mod.load_state


def test_ac3_cli_migrate_uses_renamed_symbols_and_exits_cleanly(tmp_path, monkeypatch):
    """AC3: datum/cli.py's migrate command imports the renamed symbols
    from datum.migrate (not the old load_state/save_state names) and
    still prints the clean "Nothing to do" message with exit 0 when there
    is neither a legacy state.json nor a .wfc directory.

    We make the renamed-import requirement observable by deleting the old
    load_state/save_state attributes off datum.migrate (as they will not
    exist post-migration) and proving `migrate` still succeeds -- which
    only holds if cli.py imports the renamed symbols instead.
    """
    monkeypatch.chdir(tmp_path)
    monkeypatch.delattr(migrate_mod, "load_state", raising=False)
    monkeypatch.delattr(migrate_mod, "save_state", raising=False)

    result = runner.invoke(app, ["migrate"])

    assert result.exit_code == 0
    assert (
        "No legacy .wfc/ directory or .datum/state.json found. Nothing to do."
        in result.stdout
    )


def test_ac3_cli_migrate_nothing_to_do_message_exact(tmp_path, monkeypatch):
    """AC3 negative/error-path companion: even without deleting the old
    attributes, a repo with neither legacy state.json nor .wfc/ must exit
    0 and print exactly the documented "Nothing to do" sentence -- proving
    the renamed-symbol import didn't change this observable contract.
    """
    monkeypatch.chdir(tmp_path)

    result = runner.invoke(app, ["migrate"])

    assert result.exit_code == 0
    assert (
        "No legacy .wfc/ directory or .datum/state.json found. Nothing to do."
        in result.stdout
    )


def test_ac4_migrate_path_lands_upgraded_state_in_state_db(tmp_path, monkeypatch):
    """AC4: running the migrate path against a repo containing a legacy
    .datum/state.json (and no state.db) results in that dict being
    readable afterwards via datum.state.load_state(), with the
    schema-version upgrade from migrate_state() applied.
    """
    monkeypatch.chdir(tmp_path)
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir()
    legacy_state = {"schema_version": "1.0.0", "skill_version": "0.0.1"}
    (datum_dir / "state.json").write_text(json.dumps(legacy_state))

    assert not (datum_dir / "state.db").exists()

    runner.invoke(app, ["migrate"])

    target_version = migrate_mod.current_skill_version()
    migrated = state_mod.load_state()

    assert migrated != {}
    assert migrated.get("skill_version") == target_version
    assert migrated.get("schema_version") == "1.0.0"
    assert migrated.get("brief_defects") == []
    assert migrated.get("lane_tools_added") == []
    assert migrated.get("gitnexus_degraded") is False


def test_ac5_migrate_state_and_migrate_wfc_directory_signatures_unchanged(
    tmp_path, monkeypatch
):
    """AC5: migrate_state() and migrate_wfc_directory() keep their current
    signatures and behaviour -- exact regression guard so a later refactor
    of the legacy-import surface can't silently change these two.
    """
    monkeypatch.chdir(tmp_path)

    state, changes = migrate_mod.migrate_state({"skill_version": "0.0.1"}, "9.9.9")
    assert state["skill_version"] == "9.9.9"
    assert state["schema_version"] == "1.0.0"
    assert "updated skill_version 0.0.1 -> 9.9.9" in changes
    assert "set schema_version=1.0.0" in changes
    assert state["brief_defects"] == []
    assert state["lane_tools_added"] == []
    assert state["gitnexus_degraded"] is False
    assert state["gitnexus_degraded_log"] is None

    empty_state, empty_changes = migrate_mod.migrate_state({}, "9.9.9")
    assert empty_state == {}
    assert empty_changes == []

    dir_changes = migrate_mod.migrate_wfc_directory(dry_run=True)
    assert dir_changes == []

    wfc_dir = tmp_path / ".wfc"
    wfc_dir.mkdir()
    dry_changes = migrate_mod.migrate_wfc_directory(dry_run=True)
    assert dry_changes == ["renamed .wfc directory to .datum"]
    assert wfc_dir.exists()  # dry_run must not actually rename

    real_changes = migrate_mod.migrate_wfc_directory(dry_run=False)
    assert real_changes == ["renamed .wfc directory to .datum"]
    assert not wfc_dir.exists()
    assert (tmp_path / ".datum").exists()
