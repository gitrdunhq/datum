"""Tests for datum.pipeline_state — the deterministic .datum/pipeline-state.json writer."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from typer.testing import CliRunner

from datum.cli import app
from datum.pipeline_state import (
    PipelineStateCorruptError,
    read_pipeline_state,
    reset_stale_pipeline_state,
    write_pipeline_state,
)


# elonchesd (2026-09-05): `datum init` for epic-2 overwrote the single global
# pipeline-state.json, so a fresh datum-go on epic-1 started over at Refine
# and had to be repaired by hand with four pipeline-state-save calls. The
# global file stays the "current epic" pointer the workflows read, but every
# write is mirrored per epic under .datum/epics/<slug>/pipeline-state.json,
# and switching back restores that epic's progress instead of clearing it.
def test_write_pipeline_state_mirrors_a_per_epic_copy(tmp_path: Path) -> None:
    state = write_pipeline_state(
        branch="datum/epic-1",
        run_id="r1",
        route="feature",
        completed_phases=["refine", "plan"],
        datum_dir=tmp_path,
    )
    mirror = tmp_path / "epics" / "datum-epic-1" / "pipeline-state.json"
    assert json.loads(mirror.read_text()) == state


def test_switching_epics_restores_the_other_epics_progress(tmp_path: Path) -> None:
    write_pipeline_state(
        branch="datum/epic-1",
        run_id="r1",
        route="feature",
        completed_phases=["refine", "plan", "properties", "act"],
        datum_dir=tmp_path,
    )
    prior = reset_stale_pipeline_state("datum/playable-ui-shell", datum_dir=tmp_path)
    assert prior is not None and prior["branch"] == "datum/epic-1"
    fresh = read_pipeline_state(tmp_path)
    assert fresh["branch"] == "datum/playable-ui-shell"
    assert fresh["completedPhases"] == []
    write_pipeline_state(
        branch="datum/playable-ui-shell",
        run_id="r2",
        route="feature",
        completed_phases=["refine"],
        datum_dir=tmp_path,
    )

    back = reset_stale_pipeline_state("datum/epic-1", datum_dir=tmp_path)
    assert back is not None and back["branch"] == "datum/playable-ui-shell"
    restored = read_pipeline_state(tmp_path)
    assert restored["branch"] == "datum/epic-1"
    assert restored["runId"] == "r1"
    assert restored["completedPhases"] == ["refine", "plan", "properties", "act"]
    # And epic-2's own progress survived the switch too.
    mirror2 = tmp_path / "epics" / "datum-playable-ui-shell" / "pipeline-state.json"
    assert json.loads(mirror2.read_text())["completedPhases"] == ["refine"]


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


def test_read_pipeline_state_corrupt_json_raises_instead_of_returning_none(
    tmp_path: Path,
) -> None:
    """Regression guard: a corrupted pipeline-state.json must never be
    silently treated the same as "no prior state" (returning None) — a
    caller that does `if not prior_state: start_fresh()` would misread
    corruption as a legitimate fresh lane, silently discarding tracked
    progress. Corruption must be a loud, distinguishable failure."""
    (tmp_path / "pipeline-state.json").write_text("not json")
    with pytest.raises(PipelineStateCorruptError):
        read_pipeline_state(tmp_path)


def test_reset_stale_pipeline_state_raises_on_corrupt_json(tmp_path: Path) -> None:
    (tmp_path / "pipeline-state.json").write_text("not json")
    with pytest.raises(PipelineStateCorruptError):
        reset_stale_pipeline_state("datum/new-epic", datum_dir=tmp_path)


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


def test_pipeline_state_save_fails_loudly_on_corrupt_prior_state(
    monkeypatch, tmp_path: Path
) -> None:
    """Regression guard: if .datum/pipeline-state.json exists but is corrupt,
    `pipeline-state-save` must refuse and report the corruption — not
    silently treat it as "no prior state" and start completedPhases from
    scratch, which would quietly erase a previously tracked epic's
    progress."""
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir()
    (datum_dir / "pipeline-state.json").write_text("not json")

    monkeypatch.chdir(tmp_path)
    runner = CliRunner()
    with (
        patch("datum.pipeline_state.verify_phase", return_value=(True, "")),
        patch("subprocess.run") as mock_run,
    ):
        mock_run.return_value.stdout = "datum/new-epic\n"
        mock_run.return_value.returncode = 0
        result = runner.invoke(
            app,
            [
                "pipeline-state-save",
                "--phase",
                "plan",
                "--run-id",
                "20260101-000000",
                "--route",
                "feature",
            ],
        )
    assert result.exit_code != 0
    payload = json.loads(result.output)
    assert payload["verified"] is False


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


def test_pipeline_state_save_seeds_from_the_epics_own_mirror_when_the_global_file_belongs_to_another(
    monkeypatch, tmp_path: Path
) -> None:
    """elonchesd: after epic-2's init took over the global file, a save on
    epic-1 must continue epic-1's own recorded progress (its per-epic
    mirror), not restart at one phase."""
    datum_dir = tmp_path / ".datum"
    write_pipeline_state(
        branch="datum/epic-1",
        run_id="r1",
        route="feature",
        completed_phases=["refine", "plan", "properties"],
        datum_dir=datum_dir,
    )
    write_pipeline_state(
        branch="datum/epic-2",
        run_id="r2",
        route="feature",
        completed_phases=["refine"],
        datum_dir=datum_dir,
    )
    state = _invoke_save(monkeypatch, tmp_path, branch="datum/epic-1", phase="act")
    assert state["branch"] == "datum/epic-1"
    assert state["completedPhases"] == ["refine", "plan", "properties", "act"]
    mirror2 = datum_dir / "epics" / "datum-epic-2" / "pipeline-state.json"
    assert json.loads(mirror2.read_text())["completedPhases"] == ["refine"]


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


def test_write_pipeline_state_is_atomic_no_leftover_tmp_file(tmp_path: Path) -> None:
    """After a successful write, no temp file is left behind on disk."""
    write_pipeline_state(
        branch="datum/epic-1",
        run_id="run-1",
        route="feature",
        completed_phases=["refine"],
        datum_dir=tmp_path,
    )
    # The per-epic mirror under epics/ is intended; temp files anywhere are not.
    leftovers = [
        p
        for p in tmp_path.rglob("*")
        if p.is_file() and p.name != "pipeline-state.json"
    ]
    assert leftovers == [], f"unexpected leftover files: {leftovers}"
    assert {p.name for p in tmp_path.iterdir()} == {"pipeline-state.json", "epics"}


def test_write_pipeline_state_failed_write_does_not_corrupt_existing_state(
    tmp_path: Path,
) -> None:
    """A crash mid-write must leave the PREVIOUS valid state intact, not a
    truncated/corrupt file — write to a temp file first, then atomically
    replace, so a failure can never leave a half-written file at the real
    path."""
    write_pipeline_state(
        branch="datum/epic-1",
        run_id="run-1",
        route="feature",
        completed_phases=["refine"],
        datum_dir=tmp_path,
    )
    original = read_pipeline_state(tmp_path)

    with patch("pathlib.Path.replace", side_effect=OSError("simulated crash")):
        try:
            write_pipeline_state(
                branch="datum/epic-1",
                run_id="run-1",
                route="feature",
                completed_phases=["refine", "plan"],
                datum_dir=tmp_path,
            )
        except OSError:
            pass

    survived = read_pipeline_state(tmp_path)
    assert survived == original, "a failed write must not corrupt the prior state"


# ---------------------------------------------------------------------------
# Coverage gap: verify_phase() — the core "never trust a bare claim" check
# this module exists for — was only ever mocked in other tests, never
# exercised directly against real git log evidence.
# ---------------------------------------------------------------------------

import subprocess  # noqa: E402

from datum.pipeline_state import verify_phase  # noqa: E402


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, check=True
    )


def _git_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(["init", "-q"], cwd=repo)
    _git(["config", "user.email", "t@t.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo)
    (repo / "f.txt").write_text("x\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "init"], cwd=repo)
    return repo


def test_verify_phase_act_finds_matching_commit(tmp_path, monkeypatch):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)
    (repo / "g.txt").write_text("y\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "act(run-1): merge lanes"], cwd=repo)

    found, reason = verify_phase("act", run_id="run-1")
    assert found is True
    assert reason == ""


def test_verify_phase_act_no_matching_commit_gives_a_reason(tmp_path, monkeypatch):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)

    found, reason = verify_phase("act", run_id="run-1")
    assert found is False
    assert "run-1" in reason or "act" in reason


def test_verify_phase_validate_false_tests_pass_fails_with_reason(
    tmp_path, monkeypatch
):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)

    found, reason = verify_phase("validate", tests_pass=False)
    assert found is False
    assert "did not actually pass" in reason


def test_verify_phase_validate_true_tests_pass_succeeds(tmp_path, monkeypatch):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)

    found, reason = verify_phase("validate", tests_pass=True)
    assert found is True
    assert reason == ""


def test_verify_phase_refine_finds_prefixed_commit(tmp_path, monkeypatch):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)
    (repo / "SPEC.md").write_text("spec\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "refine: write SPEC.md"], cwd=repo)

    found, reason = verify_phase("refine")
    assert found is True
    assert reason == ""


def test_verify_phase_refine_no_prefixed_commit_fails_with_reason(
    tmp_path, monkeypatch
):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)

    found, reason = verify_phase("refine")
    assert found is False
    assert "refine:" in reason


def test_verify_phase_unknown_phase_fails_with_reason(tmp_path, monkeypatch):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)

    found, reason = verify_phase("not-a-real-phase")
    assert found is False
    assert "unknown phase" in reason


def test_verify_phase_act_matches_batched_merge_commit(tmp_path, monkeypatch):
    """Multi-batch runs (>5 lanes) write `act(<run_id>-b<N>): merge ...`
    (skills/src/shared/lane-steps.ts mergeSteps, batchRunId = `${runId}-b${bi}`).
    verify_phase must recognise those as Act evidence for run_id, or every
    large epic fails `pipeline-state-save --phase act`."""
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)
    (repo / "g.txt").write_text("y\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "act(20260904-190313-b0): merge 5 lanes"], cwd=repo)
    (repo / "h.txt").write_text("z\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "act(20260904-190313-b1): merge 3 lanes"], cwd=repo)

    found, reason = verify_phase("act", run_id="20260904-190313")
    assert found is True, reason


def test_verify_phase_act_does_not_match_a_different_run_with_the_same_prefix(
    tmp_path, monkeypatch
):
    repo = _git_repo(tmp_path)
    monkeypatch.chdir(repo)
    (repo / "g.txt").write_text("y\n")
    _git(["add", "."], cwd=repo)
    _git(["commit", "-q", "-m", "act(20260904-1903131): merge 2 lanes"], cwd=repo)

    found, _ = verify_phase("act", run_id="20260904-190313")
    assert found is False
