"""Task-008 — datum-tui/data.py's load_state() must read `.datum/state.db`
via the stdlib sqlite3 module (kv_state table, key 'current'), never
`.datum/state.json`, and must import nothing from the datum package.

AC4: load_state() reads .datum/state.db via stdlib sqlite3 (kv_state table,
     key 'current'), imports nothing from the datum package, and returns {}
     rather than raising when the db is missing, unreadable or uninitialised.
AC5: covered behaviourally by
     ``test_data_module_reads_state_db_with_datum_package_import_blocked``:
     the module keeps working with `import datum` poisoned to always raise.

RED: today's data.py only reads .datum/state.json and never touches
state.db at all, so every test below fails against the current
implementation.
"""

from __future__ import annotations

import builtins
import importlib
import sqlite3
import sys
from pathlib import Path

import pytest

_DATUM_TUI_DIR = Path(__file__).parent.parent / "datum-tui"


def _write_state_db(datum_dir: Path, current_json: str) -> None:
    datum_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(datum_dir / "state.db")
    conn.execute("CREATE TABLE kv_state (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute(
        "INSERT INTO kv_state (key, value) VALUES ('current', ?)", (current_json,)
    )
    conn.commit()
    conn.close()


@pytest.fixture()
def data_module():
    sys.path.insert(0, str(_DATUM_TUI_DIR))
    try:
        if "data" in sys.modules:
            module = importlib.reload(sys.modules["data"])
        else:
            module = importlib.import_module("data")
        yield module
    finally:
        if str(_DATUM_TUI_DIR) in sys.path:
            sys.path.remove(str(_DATUM_TUI_DIR))
        if "data" in sys.modules:
            del sys.modules["data"]


class TestLoadStateFromStateDb:
    def test_load_state_reads_values_saved_via_datum_state_save_state(
        self, data_module, tmp_path, monkeypatch
    ):
        from datum.state import save_state

        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("DATUM_PROJECT_DIR", ".")

        save_state({"run_id": "task-008-run", "current_phase": "act", "phases": {}})

        # save_state() also writes a legacy write-through state.json; remove
        # it so this test proves data.py reads state.db, not the JSON file.
        json_path = tmp_path / ".datum" / "state.json"
        if json_path.exists():
            json_path.unlink()

        result = data_module.load_state()

        assert result.get("run_id") == "task-008-run"
        assert result.get("current_phase") == "act"

    def test_load_state_reads_kv_state_table_directly_via_sqlite3(
        self, data_module, tmp_path, monkeypatch
    ):
        datum_dir = tmp_path / ".datum"
        _write_state_db(
            datum_dir, '{"run_id": "hand-built", "current_phase": "review"}'
        )
        monkeypatch.setenv("DATUM_PROJECT_DIR", str(tmp_path))

        result = data_module.load_state()

        assert result == {"run_id": "hand-built", "current_phase": "review"}

    def test_load_state_returns_empty_dict_when_db_missing_even_if_stale_json_present(
        self, data_module, tmp_path, monkeypatch
    ):
        # A stale legacy state.json is present but there is no state.db —
        # per AC4, load_state() must be backed by state.db only, so this
        # must return {} rather than falling back to the JSON file.
        datum_dir = tmp_path / ".datum"
        datum_dir.mkdir(parents=True)
        (datum_dir / "state.json").write_text(
            '{"run_id": "legacy-json-run", "current_phase": "closeout"}'
        )
        monkeypatch.setenv("DATUM_PROJECT_DIR", str(tmp_path))

        result = data_module.load_state()

        assert result == {}

    def test_load_state_returns_empty_dict_when_db_corrupt_even_if_stale_json_present(
        self, data_module, tmp_path, monkeypatch
    ):
        datum_dir = tmp_path / ".datum"
        datum_dir.mkdir(parents=True)
        (datum_dir / "state.db").write_bytes(b"not a sqlite database at all")
        (datum_dir / "state.json").write_text(
            '{"run_id": "legacy-json-run", "current_phase": "closeout"}'
        )
        monkeypatch.setenv("DATUM_PROJECT_DIR", str(tmp_path))

        result = data_module.load_state()

        assert result == {}


class TestDataModuleIndependentOfDatumPackage:
    def test_data_module_reads_state_db_with_datum_package_import_blocked(
        self, tmp_path, monkeypatch
    ):
        """AC5 behavioural proxy: poison `import datum` so it always raises,
        then prove data.py still imports cleanly and load_state() still
        reads real values back out of state.db without ever touching the
        datum package."""
        for name in [
            m for m in list(sys.modules) if m == "datum" or m.startswith("datum.")
        ]:
            monkeypatch.delitem(sys.modules, name, raising=False)

        real_import = builtins.__import__

        def _blocking_import(name, *args, **kwargs):
            if name == "datum" or name.startswith("datum."):
                raise ImportError(f"data.py must not import {name!r}")
            return real_import(name, *args, **kwargs)

        monkeypatch.setattr(builtins, "__import__", _blocking_import)

        sys.path.insert(0, str(_DATUM_TUI_DIR))
        try:
            if "data" in sys.modules:
                del sys.modules["data"]
            module = importlib.import_module("data")

            datum_dir = tmp_path / ".datum"
            _write_state_db(datum_dir, '{"run_id": "isolated-from-datum-pkg"}')
            monkeypatch.setenv("DATUM_PROJECT_DIR", str(tmp_path))

            result = module.load_state()
            assert result == {"run_id": "isolated-from-datum-pkg"}
        finally:
            if str(_DATUM_TUI_DIR) in sys.path:
                sys.path.remove(str(_DATUM_TUI_DIR))
            if "data" in sys.modules:
                del sys.modules["data"]
