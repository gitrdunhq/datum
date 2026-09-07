"""RED tests for task-002: status_render must read live state through
datum.state.load_state instead of its own JSON-file reader.

red_note: state is persisted ONLY via datum.state.save_state() in a
tmp_path repo; the write-through .datum/state.json cache that save_state
still emits today is deleted immediately after, so only .datum/state.db
survives. Pre-migration this makes status_render.load_state() see no
state (STATE_FILE absent) and render the empty view; post-migration it
must resolve state via datum.state.load_state() and render the real data.
"""

from __future__ import annotations

import os

import pytest
from typer.testing import CliRunner

import datum.state as state
import datum.status_render as status_render
from datum.cli import app


def _write_db_only_state(tmp_path, monkeypatch, extra: dict | None = None) -> dict:
    """amended: superseded by task-012 AC1 — save_state() no longer writes a
    legacy .datum/state.json cache at all, so there is nothing left to
    delete here; only .datum/state.db is ever produced."""
    monkeypatch.chdir(tmp_path)
    fixture = {
        "run_id": "20260907-000042",
        "current_phase": "act",
        "phases": {
            "act": {"status": "in_progress"},
            "review": {"status": "pending"},
        },
        "lanes": {},
        "in_flight_count": 3,
        "in_flight_cap": 7,
        "git": {"work_branch": "feature/task-002", "head_sha": "deadbeef1234"},
        "gitnexus_degraded": False,
    }
    if extra:
        fixture.update(extra)
    state.save_state(fixture)
    json_cache = tmp_path / ".datum" / "state.json"
    assert not json_cache.exists(), "save_state must not write a legacy cache"
    assert (tmp_path / ".datum" / "state.db").exists()
    return fixture


def test_status_render_render_shows_phase_data_from_db_only_state(
    tmp_path, monkeypatch
):
    """AC: render() applied to datum.state.load_state()'s dict for a fixture
    containing a `phases` map must show that state's live data — not the
    pre-migration empty view produced when .datum/state.json is absent."""
    _write_db_only_state(tmp_path, monkeypatch)

    rendered = status_render.render(status_render.load_state())

    assert "20260907-000042" in rendered
    assert "phase: ACT" in rendered
    assert "3 in-flight" in rendered
    assert "feature/task-002" in rendered
    assert rendered != (
        "No active run. Run 'datum go' to start or 'datum init' to bootstrap."
    )


def test_status_render_module_delegates_to_datum_state_load_state(
    tmp_path, monkeypatch
):
    """AC: status_render.py contains no STATE_FILE constant and no local
    load_state definition — it must be datum.state.load_state itself."""
    monkeypatch.chdir(tmp_path)

    assert not hasattr(status_render, "STATE_FILE")
    assert status_render.load_state is state.load_state


def test_cli_status_command_resolves_state_via_datum_state(tmp_path, monkeypatch):
    """AC: datum/cli.py no longer imports load_state from datum.status_render;
    the status command resolves state via datum.state.load_state."""
    import datum.cli as cli

    assert cli.load_state is state.load_state


def test_cli_status_command_renders_db_only_state_end_to_end(tmp_path, monkeypatch):
    """End-to-end: `datum status` must show live state persisted only in
    .datum/state.db (no .datum/state.json present)."""
    _write_db_only_state(tmp_path, monkeypatch)

    result = CliRunner().invoke(app, ["status"])

    assert result.exit_code == 0, result.output
    assert "20260907-000042" in result.output
    assert "phase: ACT" in result.output


def test_render_matches_pre_migration_output_for_identical_state_dict(
    tmp_path, monkeypatch
):
    """AC: render() applied to a fixture dict containing a `phases` map
    produces the exact same text as the pre-migration JSON-backed path
    produced for the identical dict."""
    fixture = {
        "run_id": "20260907-999999",
        "current_phase": "review",
        "phases": {"review": {"status": "in_progress"}},
        "lanes": {},
        "in_flight_count": 0,
        "in_flight_cap": 7,
        "git": {"work_branch": "main", "head_sha": "cafebabe0000"},
        "gitnexus_degraded": False,
    }

    rendered = status_render.render(fixture)

    expected = (
        "datum/20260907-999999  │  phase: REVIEW  │  0 lanes  │  "
        "0 in-flight  │  0 completed  │  cap: 7\n"
        "branch: main  head: cafebab\n\n"
        "gitnexus: active   brief_defects: 0   flakies: 0/3"
    )
    assert rendered == expected


def test_status_command_empty_view_when_state_db_absent(tmp_path, monkeypatch):
    """AC: when .datum/state.db is absent, datum.state.load_state() returns
    {} and status_render's render path emits its empty/no-state view without
    raising."""
    monkeypatch.chdir(tmp_path)
    assert not (tmp_path / ".datum" / "state.db").exists()

    assert state.load_state() == {}

    result = CliRunner().invoke(app, ["status"])

    assert result.exit_code == 0, result.output
    assert "No active run" in result.output
