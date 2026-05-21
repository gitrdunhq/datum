#!/usr/bin/env python3
"""
State manager for DATUM skill. Reads and writes .datum/state.json.

Usage:
  python3 scripts/state.py read
  python3 scripts/state.py write --phase <phase> --status <status>
  python3 scripts/state.py transition --to <phase>
  python3 scripts/state.py init --run-id <run_id>
  python3 scripts/state.py archive --run-id <run_id>
  python3 scripts/state.py lane-update --lane <id> --stage <stage> --status <status> [--sha <sha>]
"""

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_FILE = Path(".datum/state.json")
RUNS_DIR = Path(".datum/runs")
SCHEMA_VERSION = "1.0.0"

PHASES = [
    "discovery",
    "refine",
    "plan",
    "properties",
    "act",
    "validate",
    "review",
    "pr_comments",
    "closeout",
]

VALID_STATUSES = {"pending", "in_progress", "completed", "failed", "closeout_pending"}
VALID_STAGES = {"RED", "GREEN", "REFACTOR", "queued", "completed", "failed_terminal"}


def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    with STATE_FILE.open() as f:
        return json.load(f)


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    tmp = STATE_FILE.with_suffix(".tmp")
    with tmp.open("w") as f:
        json.dump(state, f, indent=2)
    tmp.replace(STATE_FILE)


def next_epic_number() -> int:
    if not RUNS_DIR.exists():
        return 1
    existing = [
        d.name for d in RUNS_DIR.iterdir() if d.is_dir() and d.name.startswith("epic-")
    ]
    if not existing:
        return 1
    numbers = []
    for name in existing:
        parts = name.split("-")
        if len(parts) >= 2 and parts[1].isdigit():
            numbers.append(int(parts[1]))
    return max(numbers, default=0) + 1


def cmd_read(args: argparse.Namespace) -> None:
    state = load_state()
    if not state:
        print(json.dumps({"error": "no_state", "message": "No .datum/state.json found"}))
        sys.exit(1)
    print(json.dumps(state, indent=2))


def cmd_init(args: argparse.Namespace) -> None:
    n = next_epic_number()
    now = datetime.now(timezone.utc)
    run_id = args.run_id or f"epic-{n}-{now.strftime('%Y%m%d-%H%M%S')}"
    state = {
        "schema_version": SCHEMA_VERSION,
        "run_id": run_id,
        "skill_version": "1.0.0",
        "current_phase": "refine",
        "phases": {phase: {"status": "pending"} for phase in PHASES},
        "lanes": {},
        "in_flight_count": 0,
        "in_flight_cap": 7,
        "git": {
            "base_branch": args.base_branch or "main",
            "work_branch": f"datum/epic-{n}",
            "head_sha": None,
        },
        "brief_defects": [],
        "lane_tools_added": [],
        "gitnexus_degraded": False,
        "gitnexus_degraded_log": None,
        "config_hash": None,
        "gitnexus_index_sha": None,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    save_state(state)
    print(json.dumps({"ok": True, "run_id": run_id}))


def cmd_write(args: argparse.Namespace) -> None:
    state = load_state()
    if not state:
        print(json.dumps({"error": "no_state"}))
        sys.exit(1)

    if args.phase:
        if args.phase not in PHASES:
            print(json.dumps({"error": f"unknown phase: {args.phase}"}))
            sys.exit(1)
        phase_data = state["phases"].get(args.phase, {})
        if args.status:
            if args.status not in VALID_STATUSES:
                print(json.dumps({"error": f"unknown status: {args.status}"}))
                sys.exit(1)
            phase_data["status"] = args.status
        if args.model:
            phase_data["model"] = args.model
        if args.artifact:
            phase_data["artifact"] = args.artifact
        if args.status == "completed":
            phase_data["completed_at"] = datetime.now(timezone.utc).isoformat()
        elif args.status == "in_progress":
            phase_data["started_at"] = datetime.now(timezone.utc).isoformat()
        state["phases"][args.phase] = phase_data

    save_state(state)
    print(json.dumps({"ok": True}))


def cmd_transition(args: argparse.Namespace) -> None:
    state = load_state()
    if not state:
        print(json.dumps({"error": "no_state"}))
        sys.exit(1)
    if args.to not in PHASES:
        print(json.dumps({"error": f"unknown phase: {args.to}"}))
        sys.exit(1)
    state["current_phase"] = args.to
    save_state(state)
    print(json.dumps({"ok": True, "current_phase": args.to}))


def cmd_lane_update(args: argparse.Namespace) -> None:
    state = load_state()
    if not state:
        print(json.dumps({"error": "no_state"}))
        sys.exit(1)

    lane = state["lanes"].get(
        args.lane,
        {
            "stage": "queued",
            "stages": {},
            "files_touched": [],
            "depends_on": [],
            "blocked_on_dependency": [],
            "blocked_on_file_conflict": None,
        },
    )

    if args.stage:
        if args.stage not in VALID_STAGES:
            print(json.dumps({"error": f"unknown stage: {args.stage}"}))
            sys.exit(1)
        lane["stage"] = args.stage
        stage_data = lane["stages"].get(args.stage, {"status": "pending", "retries": 0})
        if args.status:
            stage_data["status"] = args.status
        if args.sha:
            stage_data["commit_sha"] = args.sha
        if args.retries is not None:
            stage_data["retries"] = args.retries
        lane["stages"][args.stage] = stage_data

    if args.sub_stage:
        lane["sub_stage"] = args.sub_stage

    state["lanes"][args.lane] = lane
    save_state(state)
    print(json.dumps({"ok": True}))


def cmd_archive(args: argparse.Namespace) -> None:
    state = load_state()
    run_id = args.run_id or (state.get("run_id") if state else None)
    if not run_id:
        print(json.dumps({"error": "no run_id"}))
        sys.exit(1)

    archive_dir = RUNS_DIR / run_id
    archive_dir.mkdir(parents=True, exist_ok=True)

    if STATE_FILE.exists():
        shutil.copy(STATE_FILE, archive_dir / "state.json")

    print(json.dumps({"ok": True, "archived_to": str(archive_dir)}))


def main() -> None:
    parser = argparse.ArgumentParser(description="DATUM state manager")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("read")

    init_p = subparsers.add_parser("init")
    init_p.add_argument("--run-id")
    init_p.add_argument("--base-branch", default="main")

    write_p = subparsers.add_parser("write")
    write_p.add_argument("--phase")
    write_p.add_argument("--status")
    write_p.add_argument("--model")
    write_p.add_argument("--artifact")

    trans_p = subparsers.add_parser("transition")
    trans_p.add_argument("--to", required=True)

    lane_p = subparsers.add_parser("lane-update")
    lane_p.add_argument("--lane", required=True)
    lane_p.add_argument("--stage")
    lane_p.add_argument("--sub-stage")
    lane_p.add_argument("--status")
    lane_p.add_argument("--sha")
    lane_p.add_argument("--retries", type=int)

    arch_p = subparsers.add_parser("archive")
    arch_p.add_argument("--run-id")

    args = parser.parse_args()

    cmds = {
        "read": cmd_read,
        "init": cmd_init,
        "write": cmd_write,
        "transition": cmd_transition,
        "lane-update": cmd_lane_update,
        "archive": cmd_archive,
    }
    cmds[args.command](args)


if __name__ == "__main__":
    main()
