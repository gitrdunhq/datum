#!/usr/bin/env python3
"""
State manager for DATUM Product skill (Pre-Dev). Reads and writes .datum/product_state.json.

Usage:
  python3 -m datum.product_state read
  python3 -m datum.product_state write --phase <phase> --status <status>
  python3 -m datum.product_state transition --to <phase>
  python3 -m datum.product_state init --run-id <run_id>
"""

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

STATE_FILE = Path(".datum/product_state.json")
RUNS_DIR = Path(".datum/runs")
SCHEMA_VERSION = "1.0.0"

PHASES = [
    "triage",
    "discovery",
    "requirements",
    "handoff",
]

VALID_STATUSES = {"pending", "in_progress", "completed", "failed"}

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
        print(json.dumps({"error": "no_state", "message": "No .datum/product_state.json found"}))
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
        "current_phase": "triage",
        "phases": {phase: {"status": "pending"} for phase in PHASES},
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

def main() -> None:
    parser = argparse.ArgumentParser(description="DATUM Product state manager")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("read")

    init_p = subparsers.add_parser("init")
    init_p.add_argument("--run-id")

    write_p = subparsers.add_parser("write")
    write_p.add_argument("--phase")
    write_p.add_argument("--status")
    write_p.add_argument("--model")
    write_p.add_argument("--artifact")

    trans_p = subparsers.add_parser("transition")
    trans_p.add_argument("--to", required=True)

    args = parser.parse_args()

    cmds = {
        "read": cmd_read,
        "init": cmd_init,
        "write": cmd_write,
        "transition": cmd_transition,
    }
    cmds[args.command](args)

if __name__ == "__main__":
    main()
