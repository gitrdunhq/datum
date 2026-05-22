#!/usr/bin/env python3
"""Collect task completion metrics from state.json."""

import json
import sys
from pathlib import Path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.collect-tasks.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    state_path = Path(f".datum/runs/{args.run_id}/state.json")
    if not state_path.exists():
        state_path = Path(".datum/state.json")
    if not state_path.exists():
        print(json.dumps({"error": "state.json not found"}))
        sys.exit(1)

    state = json.loads(state_path.read_text())
    lanes = state.get("lanes", {})

    total = len(lanes)
    completed = sum(1 for lane in lanes.values() if lane.get("stage") == "completed")
    failed = sum(1 for lane in lanes.values() if lane.get("stage") == "failed_terminal")
    say_do = completed / total if total else 0

    per_stage_retries: dict = {"RED": 0, "GREEN": 0, "REFACTOR": 0}
    for lane in lanes.values():
        for stage, sdata in lane.get("stages", {}).items():
            if stage in per_stage_retries:
                per_stage_retries[stage] += sdata.get("retries", 0)

    data = {
        "total": total,
        "completed": completed,
        "failed_terminal": failed,
        "say_do_ratio": round(say_do, 3),
        "per_stage_retries": per_stage_retries,
        "brief_defects": state.get("brief_defects", []),
        "lane_tools_added": state.get("lane_tools_added", []),
    }

    out = Path(f".datum/runs/{args.run_id}/closeout-raw/tasks.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "data": data}))


if __name__ == "__main__":
    main()
