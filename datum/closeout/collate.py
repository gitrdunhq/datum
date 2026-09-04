#!/usr/bin/env python3
"""Combine all collector outputs into closeout-data.json."""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from pydantic import ValidationError

from datum.models.closeout_data_schema import CloseoutData

COLLECTORS = [
    "git",
    "tasks",
    "platform",
    "lane_tools",
    "brief_defects",
    "token_metrics",
    "gitnexus_diff",
    "solutions",
]


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--merge-sha", required=True)
    parser.add_argument("--epic-number", type=int, required=True)
    args = parser.parse_args()

    raw_dir = Path(f".datum/runs/{args.run_id}/closeout-raw")
    if not raw_dir.exists():
        print(json.dumps({"error": "closeout-raw/ not found — run collectors first"}))
        sys.exit(1)

    state_path = Path(f".datum/runs/{args.run_id}/state.json")
    if not state_path.exists():
        state_path = Path(".datum/state.json")

    ts_result = subprocess.run(
        ["git", "log", "-1", "--format=%aI", args.merge_sha],
        capture_output=True,
        text=True,
    )
    merge_timestamp = None
    if ts_result.returncode == 0 and ts_result.stdout.strip():
        try:
            merge_timestamp = datetime.fromisoformat(ts_result.stdout.strip())
        except ValueError:
            merge_timestamp = None

    data: dict = {
        "run_id": args.run_id,
        "epic_number": args.epic_number,
        "merge_sha": args.merge_sha,
        "merge_timestamp": merge_timestamp.isoformat() if merge_timestamp else None,
    }

    for collector in COLLECTORS:
        collector_file = raw_dir / f"{collector}.json"
        if collector_file.exists():
            data[collector] = json.loads(collector_file.read_text())
        else:
            data[collector] = None

    # Flatten well-known keys
    if data.get("git"):
        data["git"] = data["git"]
    if data.get("tasks"):
        task_data = data["tasks"]
        data["tasks"] = {k: v for k, v in task_data.items() if k != "brief_defects"}
        if "brief_defects" not in data or not data["brief_defects"]:
            data["brief_defects"] = task_data.get("brief_defects", [])
        if "lane_tools_added" not in data or not data["lane_tools_added"]:
            data["lane_tools"] = task_data.get("lane_tools_added", [])

    if data.get("token_metrics") is None:
        data["token_metrics"] = {"total_input": 0, "total_output": 0}

    try:
        CloseoutData(**data)
    except ValidationError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "closeout-data.json failed schema validation — not written",
                    "details": exc.errors(include_url=False),
                }
            )
        )
        sys.exit(1)

    out = Path(f".datum/runs/{args.run_id}/closeout-data.json")
    out.write_text(json.dumps(data, indent=2))
    print(json.dumps({"ok": True, "output": str(out)}))


if __name__ == "__main__":
    main()
