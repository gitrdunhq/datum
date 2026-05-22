#!/usr/bin/env python3
"""Combine all collector outputs into closeout-data.json."""

import json
import sys
from pathlib import Path

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

    data: dict = {
        "run_id": args.run_id,
        "epic_number": args.epic_number,
        "merge_sha": args.merge_sha,
        "merge_timestamp": None,
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

    out = Path(f".datum/runs/{args.run_id}/closeout-data.json")
    out.write_text(json.dumps(data, indent=2))
    print(json.dumps({"ok": True, "output": str(out)}))


if __name__ == "__main__":
    main()
