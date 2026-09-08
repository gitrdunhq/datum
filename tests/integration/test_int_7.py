"""Integration invariants covering task-001, task-012 (state-single-source-
of-truth epic).

This is a `kind: "integration"` lane (task-INT-7): its acceptance criteria
describe behaviour that task-001 (the decision doc,
docs/architecture/state-store.md) and task-012 (datum/state.py's dropped
write-through, datum/gc.py's protected-names update) already merged. Per
contract_summary in this lane's spec, these tests are expected to PASS
against the already-merged code -- a failing test here is a finding, not a
placeholder to be filled in during GREEN.

INV-6: `gc.py`'s protected-names set is updated to match the Requirement-1
decision, and `gate.py`/`gc.py` otherwise remain untouched by accessor
migration.

INV-Q1: `.datum/state.json` as a live write-through cache is dropped
entirely; only `.datum/runs/<run_id>/state.json` (archival export) and
`datum-tui`'s state.db-backed read survive.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from datum.gc import _PROTECTED_NAMES
from datum.state import load_state, save_state, update_state

REPO_ROOT = Path(__file__).resolve().parents[2]
GATE_PY = REPO_ROOT / "datum" / "gate.py"
GC_PY = REPO_ROOT / "datum" / "gc.py"


class TestInv6ProtectedNamesMatchRequirement1Decision:
    """gc.py's _PROTECTED_NAMES must drop 'state.json' (the live write-
    through cache no longer exists) while keeping the sqlite-backed
    artifacts protected."""

    def test_state_json_is_no_longer_a_protected_name(self) -> None:
        assert "state.json" not in _PROTECTED_NAMES

    def test_state_db_and_its_wal_shm_siblings_remain_protected(self) -> None:
        assert "state.db" in _PROTECTED_NAMES
        assert "state.db-shm" in _PROTECTED_NAMES
        assert "state.db-wal" in _PROTECTED_NAMES

    def test_config_toml_remains_protected(self) -> None:
        assert "config.toml" in _PROTECTED_NAMES


class TestInv6GateAndGcUntouchedByAccessorMigration:
    """gate.py and gc.py must carry no state.json/state.db read/write
    outside of gc.py's protected-names string literals."""

    def test_gate_py_has_no_state_json_or_state_db_reference(self) -> None:
        src = GATE_PY.read_text()
        assert "state.json" not in src
        assert "state.db" not in src

    def test_gc_py_only_references_state_files_as_protected_name_literals(
        self,
    ) -> None:
        src = GC_PY.read_text()
        # gc.py never reads file *contents* for state.json/state.db -- it
        # must not call an accessor like load_state/save_state on them.
        assert "load_state(" not in src
        assert "save_state(" not in src
        assert "update_state(" not in src


class TestInvQ1LiveWriteThroughCacheDropped:
    """save_state()/update_state() must no longer write .datum/state.json;
    .datum/state.db is the sole live store of record."""

    def test_save_state_does_not_create_a_live_state_json_file(
        self, tmp_path, monkeypatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        save_state({"run_id": "int7-run", "current_phase": "act", "phases": {}})

        assert not (tmp_path / ".datum" / "state.json").exists()
        assert (tmp_path / ".datum" / "state.db").exists()

    def test_update_state_does_not_create_a_live_state_json_file(
        self, tmp_path, monkeypatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        save_state({"run_id": "int7-run", "current_phase": "act", "phases": {}})

        def _mutate(state: dict) -> None:
            state["current_phase"] = "review"

        update_state(_mutate)

        assert not (tmp_path / ".datum" / "state.json").exists()

    def test_load_state_round_trips_via_state_db_only(
        self, tmp_path, monkeypatch
    ) -> None:
        monkeypatch.chdir(tmp_path)
        save_state({"run_id": "int7-run", "current_phase": "act", "phases": {}})

        result = load_state()

        assert result["run_id"] == "int7-run"
        assert result["current_phase"] == "act"


class TestInvQ1ArchivalExportAndTuiReadSurvive:
    """The archival export path (.datum/runs/<run_id>/state.json) and
    datum-tui's state.db-backed read are the two survivors named by
    INV-Q1; both must remain functional."""

    def test_archive_snapshots_live_state_into_run_scoped_state_json(
        self, tmp_path, monkeypatch
    ) -> None:
        import subprocess
        import sys

        monkeypatch.chdir(tmp_path)
        save_state({"run_id": "int7-run", "current_phase": "closeout"})

        script = REPO_ROOT / "datum" / "closeout" / "archive.py"
        result = subprocess.run(
            [sys.executable, str(script), "--run-id", "int7-run"],
            cwd=tmp_path,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr

        archived = tmp_path / ".datum" / "runs" / "int7-run" / "state.json"
        assert archived.exists()
        archived_state = json.loads(archived.read_text())
        assert archived_state["run_id"] == "int7-run"
        # The live write-through cache must not reappear as a side effect.
        assert not (tmp_path / ".datum" / "state.json").exists()

    def test_datum_tui_data_reads_current_state_from_state_db_kv_table(
        self, tmp_path, monkeypatch
    ) -> None:
        import importlib
        import sys

        datum_dir = tmp_path / ".datum"
        datum_dir.mkdir(parents=True)
        conn = sqlite3.connect(datum_dir / "state.db")
        conn.execute("CREATE TABLE kv_state (key TEXT PRIMARY KEY, value TEXT)")
        conn.execute(
            "INSERT INTO kv_state (key, value) VALUES ('current', ?)",
            (json.dumps({"run_id": "tui-read-run"}),),
        )
        conn.commit()
        conn.close()

        tui_dir = REPO_ROOT / "datum-tui"
        sys.path.insert(0, str(tui_dir))
        try:
            if "data" in sys.modules:
                data_module = importlib.reload(sys.modules["data"])
            else:
                data_module = importlib.import_module("data")
            monkeypatch.setenv("DATUM_PROJECT_DIR", str(tmp_path))
            result = data_module.load_state()
        finally:
            sys.path.remove(str(tui_dir))
            if "data" in sys.modules:
                del sys.modules["data"]

        assert result == {"run_id": "tui-read-run"}
