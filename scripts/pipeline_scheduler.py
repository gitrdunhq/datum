#!/usr/bin/env python3
"""
pipeline_scheduler.py — Manages concurrent lane execution for the ACT phase.

Reads lane-plan.json and .datum/state.json, dispatches lanes respecting:
  - Within-lane sequencing (RED → GREEN → REFACTOR)
  - Dependency DAG (signature deps unblock on stub commit; behavior deps on GREEN commit)
  - File-ownership conflict gating
  - Concurrency cap (default: 7)

This module is imported by the orchestrator and also runnable as a status reporter.

Usage:
  python3 scripts/pipeline_scheduler.py status
  python3 scripts/pipeline_scheduler.py next-ready   # prints next eligible lane+stage
"""

import json
import sys
from pathlib import Path

DEFAULT_MAX_RETRY_BACKOFF_MS = 300_000


def backoff_ms(attempt: int, max_backoff_ms: int = DEFAULT_MAX_RETRY_BACKOFF_MS) -> int:
    """Exponential backoff delay before a reasoning retry (Symphony formula).

    attempt=1 → 10s, attempt=2 → 20s, attempt=3 → 40s, capped at max_backoff_ms.
    """
    return min(10_000 * (2 ** (attempt - 1)), max_backoff_ms)


STAGE_ORDER = ["RED", "GREEN", "REFACTOR"]


def load_state() -> dict:
    p = Path(".datum/state.json")
    return json.loads(p.read_text()) if p.exists() else {}


def load_lane_plan() -> dict:
    p = Path(".datum/lane-plan.json")
    return json.loads(p.read_text()) if p.exists() else {}


def get_lane_stage_status(state: dict, lane_id: str, stage: str) -> str:
    return (
        state.get("lanes", {})
        .get(lane_id, {})
        .get("stages", {})
        .get(stage, {})
        .get("status", "pending")
    )


def get_lane_sub_stage(state: dict, lane_id: str) -> str | None:
    return state.get("lanes", {}).get(lane_id, {}).get("sub_stage")


def is_stub_committed(state: dict, dep_lane: str) -> bool:
    sub_stage = get_lane_sub_stage(state, dep_lane)
    red_status = get_lane_stage_status(state, dep_lane, "RED")
    return (
        sub_stage in ("stub_committed", "test_committed", "verified_red")
        or red_status == "committed"
    )


def is_green_committed(state: dict, dep_lane: str) -> bool:
    return get_lane_stage_status(state, dep_lane, "GREEN") == "committed"


def get_in_flight_file_writes(state: dict, lane_plan: dict) -> set[str]:
    """Files currently being written by in-flight lanes."""
    in_flight_files: set[str] = set()
    for lane_id, lane_state in state.get("lanes", {}).items():
        current_stage = lane_state.get("stage")
        if current_stage in ("RED", "GREEN", "REFACTOR"):
            stage_status = get_lane_stage_status(state, lane_id, current_stage)
            if stage_status == "in_progress":
                files = lane_plan.get("lanes", {}).get(lane_id, {}).get("files", [])
                in_flight_files.update(files)
    return in_flight_files


def eligible_lanes(state: dict, lane_plan: dict) -> list[dict]:
    """Return list of {lane_id, next_stage} that are ready to dispatch."""
    cap = state.get("in_flight_cap", 7)
    in_flight = state.get("in_flight_count", 0)

    if in_flight >= cap:
        return []

    in_flight_writes = get_in_flight_file_writes(state, lane_plan)
    ready = []

    for lane_id, plan_lane in lane_plan.get("lanes", {}).items():
        lane_state = state.get("lanes", {}).get(lane_id, {})
        current_stage = lane_state.get("stage", "queued")

        if current_stage in ("completed", "failed_terminal"):
            continue

        # Determine the next stage to run
        if current_stage == "queued":
            next_stage = "RED"
        elif (
            current_stage == "RED"
            and get_lane_stage_status(state, lane_id, "RED") == "committed"
        ):
            next_stage = "GREEN"
        elif (
            current_stage == "GREEN"
            and get_lane_stage_status(state, lane_id, "GREEN") == "committed"
        ):
            next_stage = "REFACTOR"
        elif get_lane_stage_status(state, lane_id, current_stage) == "in_progress":
            continue  # already running
        else:
            continue

        # Check dependency constraints
        deps = plan_lane.get("depends_on", [])
        if next_stage == "RED":
            # Signature dependency: all deps must have stub committed
            if not all(is_stub_committed(state, dep) for dep in deps):
                continue
        elif next_stage == "GREEN":
            # Behavior dependency: all deps must have GREEN committed
            if not all(is_green_committed(state, dep) for dep in deps):
                continue

        # Check file-ownership conflict
        lane_files = set(plan_lane.get("files", []))
        if lane_files & in_flight_writes:
            continue  # write-write conflict

        ready.append({"lane_id": lane_id, "next_stage": next_stage})

        if len(ready) + in_flight >= cap:
            break

    return ready


def pipeline_status(state: dict, lane_plan: dict) -> dict:
    lanes = lane_plan.get("lanes", {})
    summary: dict = {
        "total": len(lanes),
        "queued": 0,
        "in_progress": 0,
        "completed": 0,
        "failed_terminal": 0,
        "by_stage": {"RED": 0, "GREEN": 0, "REFACTOR": 0},
    }

    for lane_id in lanes:
        lane_state = state.get("lanes", {}).get(lane_id, {})
        stage = lane_state.get("stage", "queued")
        if stage == "queued":
            summary["queued"] += 1
        elif stage == "completed":
            summary["completed"] += 1
        elif stage == "failed_terminal":
            summary["failed_terminal"] += 1
        elif stage in ("RED", "GREEN", "REFACTOR"):
            summary["in_progress"] += 1
            summary["by_stage"][stage] += 1

    summary["in_flight_count"] = state.get("in_flight_count", 0)
    summary["in_flight_cap"] = state.get("in_flight_cap", 7)
    summary["eligible"] = eligible_lanes(state, lane_plan)
    return summary


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: pipeline_scheduler.py [status|next-ready]"}))
        sys.exit(1)

    state = load_state()
    lane_plan = load_lane_plan()
    cmd = sys.argv[1]

    if cmd == "status":
        print(json.dumps(pipeline_status(state, lane_plan), indent=2))
    elif cmd == "next-ready":
        ready = eligible_lanes(state, lane_plan)
        print(json.dumps(ready, indent=2))
    else:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
