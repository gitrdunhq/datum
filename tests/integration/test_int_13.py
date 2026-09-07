"""task-INT-13: integration invariants covering task-008, task-012.

INV-7: `datum-tui/data.py` remains exempt from importing `datum` but swaps
its backing store to `state.db` before task-012 drops the JSON cache it
used to read.

This is an integration lane: these tests exercise already-merged code from
task-008 (`datum-tui/data.py`'s sqlite backing store) and task-012 (removal
of the legacy JSON cache it used to read) and are expected to PASS. A
failure here is a real finding about the migration boundary, not a test to
weaken.
"""

from __future__ import annotations

import ast
import importlib
import json
import sqlite3
import sys
from pathlib import Path

import datum.state as state_mod

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
_DATUM_TUI_DIR = _REPO_ROOT / "datum-tui"
_DATA_PY = _DATUM_TUI_DIR / "data.py"


def _load_tui_data_module():
    sys.path.insert(0, str(_DATUM_TUI_DIR))
    try:
        if "data" in sys.modules:
            return importlib.reload(sys.modules["data"])
        return importlib.import_module("data")
    finally:
        if str(_DATUM_TUI_DIR) in sys.path:
            sys.path.remove(str(_DATUM_TUI_DIR))


def test_datum_tui_data_module_never_imports_the_datum_package():
    """INV-7's exemption is narrow: datum-tui/data.py must never import the
    `datum` package itself, only stdlib modules, even though it now reads
    the same state.db the canonical accessor writes."""
    tree = ast.parse(_DATA_PY.read_text())
    imported_top_level_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imported_top_level_names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported_top_level_names.add(node.module.split(".")[0])

    assert "datum" not in imported_top_level_names


def test_datum_tui_load_state_reads_state_db_written_by_canonical_save_state(
    tmp_path, monkeypatch
):
    """The backing store swap: datum-tui/data.py's load_state() must read
    values written through datum.state.save_state() (state.db), proving it
    no longer depends on the JSON cache task-012 removed."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATUM_PROJECT_DIR", str(tmp_path))

    state_mod.save_state({"run_id": "epic-int13", "current_phase": "act"})

    tui_data = _load_tui_data_module()
    result = tui_data.load_state()

    assert result.get("run_id") == "epic-int13"
    assert result.get("current_phase") == "act"


def test_datum_tui_load_state_returns_empty_dict_when_no_state_db_exists():
    """Negative path: with no state.db present at all, load_state() must
    degrade to {} rather than raising or falling back to a legacy JSON
    cache file that task-012 has removed."""
    tui_data = _load_tui_data_module()
    result = tui_data.load_state()
    assert result == {}


def test_json_state_cache_file_is_no_longer_read_by_datum_tui_data(
    tmp_path, monkeypatch
):
    """task-012 dropped the legacy JSON state cache; datum-tui/data.py must
    ignore any leftover .datum/state.json and only surface values present
    in state.db, proving the JSON path is not consulted at all."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATUM_PROJECT_DIR", str(tmp_path))

    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir()
    (datum_dir / "state.json").write_text(
        json.dumps({"run_id": "stale-json-cache-should-be-ignored"})
    )

    conn = sqlite3.connect(datum_dir / "state.db")
    conn.execute("CREATE TABLE kv_state (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute(
        "INSERT INTO kv_state (key, value) VALUES ('current', ?)",
        (json.dumps({"run_id": "epic-db-wins"}),),
    )
    conn.commit()
    conn.close()

    tui_data = _load_tui_data_module()
    result = tui_data.load_state()

    assert result.get("run_id") == "epic-db-wins"
