"""Tests for datum.pipeline_state — the deterministic .datum/pipeline-state.json writer."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from datum.cli import app
from datum.pipeline_state import (
    read_pipeline_state,
    reset_stale_pipeline_state,
    write_pipeline_state,
)


def test_reset_stale_pipeline_state_clears_on_branch_mismatch(tmp_path: Path) -> None:
    write_pipeline_state(
        branch="datum/other-epic",
        run_id="prior-run",
        route="feature",
        completed_phases=["refine", "plan", "properties", "act"],
        datum_dir=tmp_path,
    )
    cleared = reset_stale_pipeline_state("datum/new-epic", datum_dir=tmp_path)
    assert cleared is not None
    assert cleared["branch"] == "datum/other-epic"
    state = read_pipeline_state(tmp_path)
    assert state["branch"] == "datum/new-epic"
    assert state["completedPhases"] == []


def test_reset_stale_pipeline_state_noop_on_same_branch(tmp_path: Path) -> None:
    write_pipeline_state(
        branch="datum/new-epic",
        run_id="prior-run",
        route="feature",
        completed_phases=["refine"],
        datum_dir=tmp_path,
    )
    cleared = reset_stale_pipeline_state("datum/new-epic", datum_dir=tmp_path)
    assert cleared is None
    state = read_pipeline_state(tmp_path)
    assert state["completedPhases"] == ["refine"]


def test_reset_stale_pipeline_state_noop_when_no_prior_state(tmp_path: Path) -> None:
    assert reset_stale_pipeline_state("datum/new-epic", datum_dir=tmp_path) is None
    assert read_pipeline_state(tmp_path) is None


def test_write_then_read_round_trips(tmp_path: Path) -> None:
    write_pipeline_state(
        branch="datum/epic-1",
        run_id="20260101-000000",
        route="feature",
        completed_phases=["refine", "plan"],
        datum_dir=tmp_path,
    )
    state = read_pipeline_state(tmp_path)
    assert state is not None
    assert state["branch"] == "datum/epic-1"
    assert state["completedPhases"] == ["refine", "plan"]


def test_read_pipeline_state_missing_returns_none(tmp_path: Path) -> None:
    assert read_pipeline_state(tmp_path) is None


def test_read_pipeline_state_corrupt_json_returns_none(tmp_path: Path) -> None:
    (tmp_path / "pipeline-state.json").write_text("not json")
    assert read_pipeline_state(tmp_path) is None


def _invoke_save(
    monkeypatch, tmp_path: Path, *, branch: str, phase: str = "plan"
) -> dict:
    monkeypatch.chdir(tmp_path)
    runner = CliRunner()
    with (
        patch("datum.pipeline_state.verify_phase", return_value=(True, "")),
        patch("subprocess.run") as mock_run,
    ):
        mock_run.return_value.stdout = branch + "\n"
        mock_run.return_value.returncode = 0
        result = runner.invoke(
            app,
            [
                "pipeline-state-save",
                "--phase",
                phase,
                "--run-id",
                "20260101-000000",
                "--route",
                "feature",
            ],
        )
    assert result.exit_code == 0, result.output
    return json.loads(result.output)


def test_pipeline_state_save_does_not_inherit_completed_phases_from_a_different_branch(
    monkeypatch, tmp_path: Path
) -> None:
    """Regression test: a stale pipeline-state.json left over from a prior
    epic on a different branch must never seed the new epic's completedPhases
    — this was silently marking act/validate/review/closeout as done on a
    brand-new epic that had only run refine/plan/properties."""
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir()
    (datum_dir / "pipeline-state.json").write_text(
        json.dumps(
            {
                "branch": "datum/other-epic",
                "runId": "prior-run",
                "route": "feature",
                "completedPhases": [
                    "refine",
                    "plan",
                    "properties",
                    "act",
                    "validate",
                    "review",
                    "closeout",
                ],
                "currentPhase": None,
                "lastUpdated": "2026-01-01T00:00:00",
            }
        )
    )
    state = _invoke_save(monkeypatch, tmp_path, branch="datum/new-epic", phase="plan")
    assert state["branch"] == "datum/new-epic"
    assert state["completedPhases"] == ["plan"]


def test_pipeline_state_save_inherits_completed_phases_from_the_same_branch(
    monkeypatch, tmp_path: Path
) -> None:
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir()
    (datum_dir / "pipeline-state.json").write_text(
        json.dumps(
            {
                "branch": "datum/new-epic",
                "runId": "prior-run",
                "route": "feature",
                "completedPhases": ["refine"],
                "currentPhase": None,
                "lastUpdated": "2026-01-01T00:00:00",
            }
        )
    )
    state = _invoke_save(monkeypatch, tmp_path, branch="datum/new-epic", phase="plan")
    assert state["branch"] == "datum/new-epic"
    assert state["completedPhases"] == ["refine", "plan"]
