"""task-INT-12: integration invariants covering task-007, task-008.

INV-Q4: Only `corpus_sql.py` (SQL-queryable need) and `migrate.py`
(one-shot legacy import) are permitted documented exceptions; every other
of the 12 modules ends on the canonical accessor with zero exceptions.

This is an integration lane: these tests exercise already-merged code from
task-007 (`datum/migrate.py`) and task-008 (`datum/memory/corpus_sql.py`,
`datum-tui/data.py`) and are expected to PASS. A failure here is a real
finding about the migration boundary, not a test to weaken.
"""

from __future__ import annotations

import importlib
import json
import sqlite3
import sys
from pathlib import Path

from typer.testing import CliRunner

import datum.memory.corpus_sql as corpus_sql_mod
import datum.state as state_mod
from datum.cli import app

runner = CliRunner()

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_DATUM_TUI_DIR = _REPO_ROOT / "datum-tui"


def test_migrate_py_functions_as_one_shot_legacy_state_json_importer(
    tmp_path, monkeypatch
):
    """migrate.py's permitted exception (reading legacy .datum/state.json)
    ends at its own boundary: the CLI migrate path must land that legacy
    value in the canonical store, readable afterwards through
    datum.state.load_state(), proving the exception does not leak a
    second, independently-read store."""
    monkeypatch.chdir(tmp_path)
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir()
    legacy_state = {
        "run_id": "legacy-epic-7",
        "schema_version": "1.0.0",
        "skill_version": "0.0.1",
    }
    (datum_dir / "state.json").write_text(json.dumps(legacy_state))

    runner.invoke(app, ["migrate"])

    migrated = state_mod.load_state()
    assert migrated.get("run_id") == "legacy-epic-7"
    assert migrated.get("schema_version") == "1.0.0"


def test_migrate_cli_with_no_legacy_state_json_never_raises_and_state_stays_empty(
    tmp_path, monkeypatch
):
    """Negative path: with neither a legacy .datum/state.json nor a .wfc
    directory present, the one-shot importer must not raise, and the
    canonical accessor must continue to report "no state written yet"
    ({}), never fabricate a value."""
    monkeypatch.chdir(tmp_path)

    result = runner.invoke(app, ["migrate"])

    assert result.exit_code == 0
    assert state_mod.load_state() == {}


def test_corpus_sql_reads_state_db_directly_bypassing_canonical_accessor(
    tmp_path, monkeypatch
):
    """corpus_sql.py is a permitted documented exception: it needs
    SQL-queryable access, so it attaches state.db directly via sqlite
    rather than routing through datum.state.load_state()/save_state().
    Its bypass must still surface the real values, and must degrade to an
    empty result (never raise, never fall back to state.json) when no
    state.db exists at all."""
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir()
    conn = sqlite3.connect(datum_dir / "state.db")
    conn.execute("CREATE TABLE kv_state (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute(
        "INSERT INTO kv_state (key, value) VALUES ('current', ?)",
        (
            json.dumps(
                {
                    "run_id": "epic-corpus-8",
                    "current_phase": "validate",
                    "phases": {"act": {"status": "completed"}},
                }
            ),
        ),
    )
    conn.commit()
    conn.close()

    rows = corpus_sql_mod._run_state_rows(datum_dir / "state.db")
    assert rows == [("epic-corpus-8", "validate", "act", "completed")]

    missing_datum_dir = tmp_path / "missing-db" / ".datum"
    missing_datum_dir.mkdir(parents=True)
    assert corpus_sql_mod._run_state_rows(missing_datum_dir / "state.db") == []


def test_migrate_module_never_shadows_canonical_load_or_save_state(
    tmp_path, monkeypatch
):
    """INV-Q4's exception list permits migrate.py to keep its own legacy
    reader, but not a second load_state/save_state that could silently
    diverge from the canonical accessor. If datum.migrate exposes
    load_state/save_state names at all, they must be the exact function
    objects from datum.state, never module-local reimplementations, and
    its dedicated legacy reader must read only what is actually on disk
    (never fabricate a value when state.json is absent)."""
    monkeypatch.chdir(tmp_path)
    import datum.migrate as migrate_mod

    migrate_save = getattr(migrate_mod, "save_state", None)
    assert migrate_save is None or migrate_save is state_mod.save_state

    migrate_load = getattr(migrate_mod, "load_state", None)
    assert migrate_load is None or migrate_load is state_mod.load_state

    assert migrate_mod.load_legacy_state() == {}


def test_corpus_sql_and_datum_tui_documented_exceptions_agree_on_state_db(
    tmp_path, monkeypatch
):
    """Cross-module invariant behind INV-Q4: both permitted exceptions to
    the canonical accessor read the same underlying store, so state
    written via datum.state.save_state() is observed identically by
    corpus_sql.py's direct sqlite ATTACH and by datum-tui/data.py's direct
    sqlite read -- neither exception is allowed to diverge from the
    canonical write path."""
    monkeypatch.chdir(tmp_path)
    written = {"run_id": "epic-cross-12", "current_phase": "act"}
    state_mod.save_state(written)

    datum_dir = tmp_path / ".datum"
    corpus_rows = corpus_sql_mod._run_state_rows(datum_dir / "state.db")
    assert corpus_rows == [("epic-cross-12", "act", None, None)]

    sys.path.insert(0, str(_DATUM_TUI_DIR))
    try:
        if "data" in sys.modules:
            tui_data = importlib.reload(sys.modules["data"])
        else:
            tui_data = importlib.import_module("data")
        tui_state = tui_data.load_state()
    finally:
        if str(_DATUM_TUI_DIR) in sys.path:
            sys.path.remove(str(_DATUM_TUI_DIR))

    assert tui_state.get("run_id") == "epic-cross-12"
    assert tui_state.get("current_phase") == "act"
