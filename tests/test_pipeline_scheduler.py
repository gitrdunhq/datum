"""RED (task-011): pipeline_scheduler.py must migrate off its own
Path(".datum/state.json") + `load_state()` and read live state through
datum.state.load_state() instead — the single source of truth. This is an
equivalence test: it seeds a fixture state dict through datum.state.save_state
and asserts the scheduler's dispatch decision matches the documented
pre-migration golden result for that same dict, and that a stale/disagreeing
.datum/state.json alongside the live store never changes the dispatch set.

See docs/epics/datum/state-single-source-of-truth/lane-plan.json, task-011.
"""

from __future__ import annotations

import json

import pytest

import datum.pipeline_scheduler as scheduler
import datum.state as state_mod

# Golden lane-plan fixture used across the equivalence tests below.
LANE_PLAN = {
    "lanes": {
        "task-a": {"depends_on": [], "files": ["a.py"]},
        "task-b": {"depends_on": ["task-a"], "files": ["b.py"]},
    }
}

# Golden state fixture: task-a has its RED and GREEN stages committed and is
# currently sitting in the GREEN stage (so its next stage is REFACTOR).
# task-b has never been touched (defaults to "queued", so its next stage is
# RED), and it's unblocked because its only dependency (task-a) has a
# committed RED stage (is_stub_committed == True).
GOLDEN_STATE = {
    "lanes": {
        "task-a": {
            "stage": "GREEN",
            "stages": {
                "RED": {"status": "committed"},
                "GREEN": {"status": "committed"},
            },
        },
    },
    "in_flight_count": 0,
    "in_flight_cap": 7,
}

# This is the exact pre-migration dispatch decision `eligible_lanes` produces
# for GOLDEN_STATE + LANE_PLAN — recorded here as a literal, not recomputed
# from any file on disk.
GOLDEN_READY = [
    {"lane_id": "task-a", "next_stage": "REFACTOR"},
    {"lane_id": "task-b", "next_stage": "RED"},
]


def _write_lane_plan(tmp_path):
    datum_dir = tmp_path / ".datum"
    datum_dir.mkdir(parents=True, exist_ok=True)
    (datum_dir / "lane-plan.json").write_text(json.dumps(LANE_PLAN))


def _run_next_ready(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["pipeline_scheduler.py", "next-ready"])
    scheduler.main()
    out = capsys.readouterr().out
    return json.loads(out)


class TestTask011AC1:
    def test_pipeline_scheduler_has_no_own_load_state_function(self):
        """AC1: datum/pipeline_scheduler.py contains no `def load_state`;
        it must delegate to datum.state.load_state() instead."""
        assert not hasattr(scheduler, "load_state")

    def test_stale_state_json_alone_is_not_read_as_live_state(
        self, tmp_path, monkeypatch, capsys
    ):
        """AC1 (behavioral): a .datum/state.json on disk with data that would
        change the dispatch decision must be ignored when there is no live
        datum.state store — proving the scheduler never falls back to
        Path(".datum/state.json") directly."""
        monkeypatch.chdir(tmp_path)
        _write_lane_plan(tmp_path)
        monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

        # No live db has ever been created — but a stale legacy state.json
        # claims task-a's RED+GREEN are committed, which (if read) would
        # make task-b eligible for RED and task-a eligible for REFACTOR.
        stale_json = tmp_path / ".datum" / "state.json"
        stale_json.write_text(json.dumps(GOLDEN_STATE))

        result = _run_next_ready(monkeypatch, capsys)

        # Since datum.state.load_state() returns {} (no db yet), only the
        # root lane (task-a, no deps) is eligible for RED — not the stale
        # json's REFACTOR/RED decision.
        assert result == [{"lane_id": "task-a", "next_stage": "RED"}]


class TestTask011AC2:
    def test_dispatch_decision_matches_golden_pre_migration_result(
        self, tmp_path, monkeypatch, capsys
    ):
        """AC2: the scheduler's dispatch decision for GOLDEN_STATE + LANE_PLAN,
        seeded via datum.state.save_state(), is byte-identical to the golden
        decision recorded as a literal above."""
        monkeypatch.chdir(tmp_path)
        _write_lane_plan(tmp_path)
        monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

        state_mod.save_state(dict(GOLDEN_STATE))

        result = _run_next_ready(monkeypatch, capsys)

        assert result == GOLDEN_READY


class TestTask011AC3:
    @pytest.mark.parametrize("stale_matches_live", [True, False])
    def test_stale_legacy_json_never_changes_dispatch_set(
        self, tmp_path, monkeypatch, capsys, stale_matches_live
    ):
        """AC3: whether the stale .datum/state.json agrees or disagrees with
        the live datum.state store, the set of ready lanes must come from the
        live store only."""
        monkeypatch.chdir(tmp_path)
        _write_lane_plan(tmp_path)
        monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "state.db")

        state_mod.save_state(dict(GOLDEN_STATE))

        stale_json = tmp_path / ".datum" / "state.json"
        if stale_matches_live:
            stale_json.write_text(json.dumps(GOLDEN_STATE))
        else:
            # Deliberately disagreeing: claims neither lane has moved at all.
            stale_json.write_text(json.dumps({"lanes": {}}))

        result = _run_next_ready(monkeypatch, capsys)

        assert result == GOLDEN_READY


class TestTask011AC4:
    def test_empty_live_state_dispatches_root_lanes_without_raising(
        self, tmp_path, monkeypatch, capsys
    ):
        """AC4: when datum.state.load_state() returns {} (no db file at all),
        the scheduler treats it as 'no state yet' and dispatches the
        lane-plan's root lanes (no depends_on) without raising."""
        monkeypatch.chdir(tmp_path)
        _write_lane_plan(tmp_path)
        monkeypatch.setattr(state_mod, "DB_FILE", tmp_path / ".datum" / "absent.db")

        assert state_mod.load_state() == {}

        result = _run_next_ready(monkeypatch, capsys)

        assert result == [{"lane_id": "task-a", "next_stage": "RED"}]


class TestTask011AC5:
    def test_module_docstring_no_longer_mentions_state_json(self):
        """AC5: the module docstring no longer says it reads
        .datum/state.json."""
        doc = scheduler.__doc__ or ""
        assert ".datum/state.json" not in doc
