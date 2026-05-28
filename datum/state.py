#!/usr/bin/env python3
"""
State manager for DATUM skill. Reads and writes .datum/state.db (SQLite).

Usage:
  python3 scripts/datum.py datum.state read
  python3 scripts/datum.py datum.state write --phase <phase> --status <status>
  python3 scripts/datum.py datum.state transition --to <phase>
  python3 scripts/datum.py datum.state init --run-id <run_id>
  python3 scripts/datum.py datum.state archive --run-id <run_id>
  python3 scripts/datum.py datum.state log-tokens --phase <phase> --model <model> --input <N> --output <N>
"""

import argparse
import json
import sqlite3
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

DB_FILE = Path(".datum/state.db")
RUNS_DIR = Path(".datum/runs")
SCHEMA_VERSION = "1.0.0"

PHASES = [
    "discovery",
    "refine",
    "plan",
    "triage",
    "deepen",
    "properties",
    "act",
    "validate",
    "review",
    "pr_comments",
    "closeout",
]

VALID_STATUSES = {"pending", "in_progress", "completed", "failed", "closeout_pending"}
VALID_STAGES = {"RED", "GREEN", "REFACTOR", "queued", "completed", "failed_terminal"}
PROTECTED_BRANCHES = {"main", "master"}


def current_branch() -> str | None:
    import subprocess

    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip() if result.returncode == 0 else None
    except Exception:
        return None


def ensure_feature_branch() -> str:
    import subprocess

    branch = current_branch()
    if branch not in PROTECTED_BRANCHES:
        return branch

    n = next_epic_number()
    new_branch = f"datum/epic-{n}"
    result = subprocess.run(
        ["git", "checkout", "-b", new_branch],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(
            json.dumps(
                {
                    "error": "branch_create_failed",
                    "branch": branch,
                    "message": f"On '{branch}' and failed to create '{new_branch}': {result.stderr.strip()}",
                }
            )
        )
        sys.exit(2)
    print(
        json.dumps(
            {
                "ok": True,
                "action": "branch_created",
                "from": branch,
                "to": new_branch,
                "message": f"Created feature branch '{new_branch}' (DATUM never works on {branch})",
            }
        ),
        file=sys.stderr,
    )
    return new_branch


def load_config() -> dict:
    try:
        import tomllib
    except ModuleNotFoundError:
        import tomli as tomllib
    config_path = Path(".datum/config.toml")
    if not config_path.exists():
        from datum.path_utils import assets_dir

        config_path = assets_dir() / "config.toml.default"
    if not config_path.exists():
        return {}
    return tomllib.loads(config_path.read_text())


def resolve_tier(phase: str, run_state: dict | None = None) -> dict:
    config = load_config()
    models = config.get("models", {})
    phases = models.get("phases", {})

    tier_name = phases.get(phase, "standard")

    if (
        config.get("pipeline", {}).get("deepen_downshift", False)
        and run_state
        and run_state.get("phases", {}).get("deepen", {}).get("status") == "completed"
        and phase in ("act_red", "act_green", "act_refactor")
    ):
        tier_name = "fast"

    model_id = models.get(tier_name, tier_name)

    return {"phase": phase, "tier": tier_name, "model": model_id}


def init_db():
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("PRAGMA journal_mode=WAL")  # Handle concurrent writes
        conn.execute("""
            CREATE TABLE IF NOT EXISTS kv_state (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS token_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phase TEXT,
                model TEXT,
                input_tokens INTEGER,
                output_tokens INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()


def load_state() -> dict:
    if not DB_FILE.exists():
        return {}
    with sqlite3.connect(DB_FILE) as conn:
        cur = conn.execute("SELECT value FROM kv_state WHERE key = 'current'")
        row = cur.fetchone()
        if row:
            return json.loads(row[0])
    return {}


def save_state(state: dict) -> None:
    init_db()
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO kv_state (key, value) VALUES ('current', ?)",
            (json.dumps(state),),
        )
        conn.commit()

    # Write-through cache for backwards compatibility with legacy scripts
    json_path = Path(".datum/state.json")
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with json_path.open("w") as f:
        json.dump(state, f, indent=2)


def next_epic_number() -> int:
    numbers: list[int] = []
    for source in [RUNS_DIR, Path("docs/epics/datum")]:
        if not source.exists():
            continue
        for d in source.iterdir():
            if not d.is_dir() or not d.name.startswith("epic-"):
                continue
            parts = d.name.split("-")
            if len(parts) >= 2 and parts[1].isdigit():
                numbers.append(int(parts[1]))
    return max(numbers, default=0) + 1


def cmd_read(args: argparse.Namespace) -> None:
    ensure_feature_branch()
    state = load_state()
    if not state:
        print(json.dumps({"error": "no_state", "message": "No .datum/state.db found"}))
        sys.exit(1)
    print(json.dumps(state, indent=2))


def cmd_init(args: argparse.Namespace) -> None:
    ensure_feature_branch()
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

    # Clear out old telemetry for new init
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("DELETE FROM token_metrics")
        conn.commit()

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


def cmd_log_tokens(args: argparse.Namespace) -> None:
    # We no longer read/write the full state JSON for token telemetry!
    # This prevents IO bottlenecks and lock contention.
    init_db()
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO token_metrics (phase, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)",
            (args.phase, args.model, args.input, args.output),
        )
        conn.commit()
    print(json.dumps({"ok": True}))


def cmd_archive(args: argparse.Namespace) -> None:
    state = load_state()
    run_id = args.run_id or (state.get("run_id") if state else None)
    if not run_id:
        print(json.dumps({"error": "no run_id"}))
        sys.exit(1)

    archive_dir = RUNS_DIR / run_id
    archive_dir.mkdir(parents=True, exist_ok=True)

    if DB_FILE.exists():
        shutil.copy(DB_FILE, archive_dir / "state.db")

    print(json.dumps({"ok": True, "archived_to": str(archive_dir)}))


def main() -> None:
    parser = argparse.ArgumentParser(description="DATUM state manager (SQLite)")
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

    log_p = subparsers.add_parser("log-tokens")
    log_p.add_argument("--phase", required=True)
    log_p.add_argument("--model", required=True)
    log_p.add_argument("--input", type=int, required=True)
    log_p.add_argument("--output", type=int, required=True)

    arch_p = subparsers.add_parser("archive")
    arch_p.add_argument("--run-id")

    args = parser.parse_args()

    cmds = {
        "read": cmd_read,
        "init": cmd_init,
        "write": cmd_write,
        "transition": cmd_transition,
        "lane-update": cmd_lane_update,
        "log-tokens": cmd_log_tokens,
        "archive": cmd_archive,
    }
    cmds[args.command](args)


if __name__ == "__main__":
    main()
