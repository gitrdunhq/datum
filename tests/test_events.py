"""#520: `datum retrospect` reads `.datum/runs/<run_id>/events.jsonl`, which
nothing in the TS Workflow pipeline wrote. datum.events is the producer:
one line per lane outcome (appended by `datum events lane`, called from
datum-go after Act) and one per completed phase (appended by
`datum pipeline-state-save`)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from datum.events import append_lane_event, append_phase_event, events_path
from datum.retrospect import RetrospectConfig, run_retrospect


@pytest.fixture
def repo(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum" / "runs").mkdir(parents=True)
    return tmp_path


def _lines(p: Path) -> list[dict]:
    return [json.loads(line) for line in p.read_text().splitlines() if line.strip()]


class TestLaneEvent:
    def test_failed_lane_is_a_failure_event_named_by_its_prefix_and_layered(self, repo):
        append_lane_event(
            "r1",
            "task-003",
            "failed",
            "GREEN",
            "green_verify_failed: independent test-verify step exit=1 (agent self-reported tests_pass=true)",
        )
        p = events_path("r1")
        assert p.resolve() == (repo / ".datum" / "runs" / "r1" / "events.jsonl").resolve()
        (ev,) = _lines(p)
        assert ev["event_type"] == "lane_outcome"
        assert ev["status"] == "failed"
        assert ev["phase"] == "act"
        assert ev["task_id"] == "task-003"
        assert ev["run_id"] == "r1"
        assert ev["payload"]["reason"] == "green_verify_failed"
        assert ev["payload"]["failure_layer"] == "verification"
        assert ev["payload"]["stage"] == "GREEN"
        assert ev["message"].startswith("green_verify_failed:")
        assert isinstance(ev["timestamp"], float)

    def test_completed_lane_has_no_reason_and_a_batch_run_id_maps_to_its_base_run(
        self, repo
    ):
        append_lane_event("r1-b2", "task-004", "completed", "REFACTOR", None)
        (ev,) = _lines(events_path("r1"))
        assert ev["status"] == "completed"
        assert "reason" not in ev["payload"]
        assert "failure_layer" not in ev["payload"]

    def test_events_append_and_never_overwrite(self, repo):
        append_lane_event("r1", "task-001", "completed", "REFACTOR", None)
        append_lane_event(
            "r1",
            "task-002",
            "blocked",
            "SKIPPED",
            "integration_dependency_unmerged: task-001",
        )
        assert [e["task_id"] for e in _lines(events_path("r1"))] == [
            "task-001",
            "task-002",
        ]

    def test_blocked_counts_as_a_failure_for_retrospect(self, repo):
        append_lane_event(
            "r1",
            "task-002",
            "blocked",
            "SKIPPED",
            "green_blocked_needs_write: [src/x.py]",
        )
        (ev,) = _lines(events_path("r1"))
        assert ev["status"] == "failed"
        assert ev["payload"]["lane_status"] == "blocked"
        assert ev["payload"]["failure_layer"] == "planning"


class TestPhaseEvent:
    def test_phase_event_carries_duration_when_known(self, repo):
        append_phase_event("r1", "act", duration_s=612.4)
        (ev,) = _lines(events_path("r1"))
        assert ev["event_type"] == "phase_complete"
        assert ev["phase"] == "act"
        assert ev["status"] == "completed"
        assert ev["payload"]["duration_s"] == 612.4

    def test_phase_event_without_a_duration_omits_the_field(self, repo):
        append_phase_event("r1", "refine", duration_s=None)
        (ev,) = _lines(events_path("r1"))
        assert "duration_s" not in ev["payload"]


class TestRetrospectReadsTheProducedEvents:
    def test_run_retrospect_sees_failures_by_layer_and_slow_phases(self, repo):
        append_lane_event(
            "r1", "task-003", "failed", "GREEN", "green_verify_failed: exit=1"
        )
        append_lane_event(
            "r1",
            "task-008",
            "failed",
            "RED",
            "batch_incomplete: 10 of 13 step records returned",
        )
        append_lane_event(
            "r2", "task-003", "failed", "GREEN", "green_verify_failed: exit=2"
        )
        append_phase_event("r1", "act", duration_s=900.0)
        append_phase_event("r1", "refine", duration_s=12.0)
        result = run_retrospect(RetrospectConfig(datum_dir=repo / ".datum"))
        assert result.runs_analysed == 2
        assert result.total_failures == 3
        assert result.failures_by_layer == {"verification": 2, "infrastructure": 1}
        assert [p["phase"] for p in result.slow_phases] == ["act"]
        assert result.recurring_patterns[0]["reason"] == "green_verify_failed"
        assert result.recurring_patterns[0]["run_count"] == 2


class TestEventsCli:
    def test_datum_events_lane_appends_one_line(self, repo):
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.cli",
                "events",
                "lane",
                "--run-id",
                "r9",
                "--task-id",
                "task-INT-1",
                "--status",
                "failed",
                "--stage",
                "RED",
                "--reason",
                "integration_failed: covered task-001; invariants INV-Q5 (independent verify exit=1)",
            ],
            cwd=repo,
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        out = json.loads(result.stdout)
        assert out["ok"] is True and out["path"].endswith(".datum/runs/r9/events.jsonl")
        (ev,) = _lines(events_path("r9"))
        assert ev["payload"]["reason"] == "integration_failed"
        assert ev["payload"]["failure_layer"] == "verification"
