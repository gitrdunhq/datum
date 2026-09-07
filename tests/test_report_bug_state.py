"""RED (task-003): report_bug must derive state from the canonical accessor
(datum.state.load_state()) instead of reading .datum/state.json directly.

See docs/epics/datum/state-single-source-of-truth/lane-plan.json, task-003.
"""

import subprocess
from pathlib import Path

import datum.state as state_mod
from datum.report_bug import _build_body


def test_no_literal_state_json_path_in_report_bug_or_archive():
    """AC: grep for the literal live-cache path returns zero matches in
    either report_bug.py or archive.py (the archival write target
    .datum/runs/<run_id>/state.json, built from RUNS_DIR/run_id, is fine)."""
    result = subprocess.run(
        ["grep", "-n", ".datum/state.json", "datum/report_bug.py", "datum/archive.py"],
        capture_output=True,
        text=True,
    )
    assert result.stdout == "", (
        "found literal '.datum/state.json' reference(s), should read via "
        "datum.state.load_state() instead:\n" + result.stdout
    )
    assert result.returncode != 0


def test_enrichment_reads_run_id_and_phase_from_canonical_state(tmp_path, monkeypatch):
    """AC: report_bug's enrichment reads state via datum.state.load_state()
    and still enriches the payload with the same keys it previously read
    out of state.json."""
    monkeypatch.chdir(tmp_path)
    state_mod.save_state({"run_id": "epic-77", "current_phase": "act"})
    # Simulate a world where the write-through JSON cache is gone — only the
    # canonical accessor (state.db, via load_state()) still has the data.
    Path(".datum/state.json").unlink()

    body = _build_body("datum.act", RuntimeError("boom"), None)

    assert "epic-77" in body
    assert "act" in body


def test_enrichment_survives_missing_state_db(tmp_path, monkeypatch):
    """AC: with .datum/state.db deleted, calling report_bug's enrichment
    step does not raise — it silently continues and produces a report
    payload without the state-derived fields."""
    monkeypatch.chdir(tmp_path)
    state_mod.save_state({"run_id": "epic-88", "current_phase": "review"})
    Path(".datum/state.db").unlink()

    # Must not raise.
    body = _build_body("datum.act", RuntimeError("kaboom"), None)

    assert "epic-88" not in body
    assert "**State:**" not in body
