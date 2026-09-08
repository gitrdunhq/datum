"""Task-008 — corpus_sql's run_state analytics must be sourced from
state.db, never from `.datum/state.json`.

AC2: datum/memory/corpus_sql.py no longer constructs a DuckDB view over
     `datum_dir / "state.json"`.
AC3: run_corpus_query returns the same result column names for its
     analytics queries when .datum/state.json does not exist on disk as it
     did when the state.json-backed view was present.

RED: today ``_setup_views`` still branches on ``state_json.exists()`` and
falls back to an empty stub table when the file is absent — the stub has
zero rows, so ``render_rows`` short-circuits to "(no rows)" and the
documented column names / real values never make it into the rendered
result. These tests fail until run_state is rebuilt from state.db.
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from datum.memory.corpus_sql import run_corpus_query

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "corpus"

_PRE_MIGRATION_RUN_STATE_COLUMNS = ["run_id", "current_phase", "phase", "status"]


def _write_state_db(datum_dir: Path, run_id: str, current_phase: str) -> None:
    """Hand-build a state.db with the documented kv_state('current') schema."""
    db_path = datum_dir / "state.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE kv_state (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute(
        "INSERT INTO kv_state (key, value) VALUES ('current', ?)",
        (
            json.dumps(
                {
                    "run_id": run_id,
                    "current_phase": current_phase,
                    "phases": {"act": {"status": "completed"}},
                }
            ),
        ),
    )
    conn.commit()
    conn.close()


@pytest.fixture()
def corpus_root_without_state_json(tmp_path: Path) -> Path:
    """Fixture corpus with state.json removed and a real state.db in its place."""
    datum_dir = tmp_path / ".datum"
    shutil.copytree(FIXTURES_DIR, datum_dir)
    (datum_dir / "state.json").unlink()
    _write_state_db(datum_dir, run_id="db-sourced-run", current_phase="validate")
    return tmp_path


class TestRunStateSourcedFromStateDb:
    def test_run_state_columns_match_pre_migration_schema_without_state_json(
        self, corpus_root_without_state_json: Path
    ):
        result = run_corpus_query(
            "SELECT * FROM run_state LIMIT 1",
            repo_root=corpus_root_without_state_json,
        )
        for column in _PRE_MIGRATION_RUN_STATE_COLUMNS:
            assert column in result, f"missing column {column!r} in: {result}"

    def test_run_state_returns_real_data_from_state_db_when_state_json_absent(
        self, corpus_root_without_state_json: Path
    ):
        result = run_corpus_query(
            "SELECT run_id, current_phase FROM run_state",
            repo_root=corpus_root_without_state_json,
        )
        assert "db-sourced-run" in result
        assert "validate" in result

    def test_run_state_ignores_stale_state_json_and_uses_state_db(self, tmp_path: Path):
        """Even when a stale/incorrect state.json is left on disk, run_state
        must reflect state.db, since state.db is the single source of truth
        (state.json is no longer read at all — AC2)."""
        datum_dir = tmp_path / ".datum"
        shutil.copytree(FIXTURES_DIR, datum_dir)
        # Overwrite the fixture's state.json with stale data that does NOT
        # match the state.db content written below.
        (datum_dir / "state.json").write_text(
            json.dumps(
                {
                    "run_id": "stale-json-run",
                    "current_phase": "triage",
                    "phases": {},
                }
            )
        )
        _write_state_db(datum_dir, run_id="fresh-db-run", current_phase="review")

        result = run_corpus_query(
            "SELECT run_id, current_phase FROM run_state",
            repo_root=tmp_path,
        )
        assert "fresh-db-run" in result
        assert "review" in result
        assert "stale-json-run" not in result
