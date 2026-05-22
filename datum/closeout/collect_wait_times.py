#!/usr/bin/env python3
"""Value Stream Mapping — collect wait times between DATUM phase transitions."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Collect phase wait times for VSM")
    parser.add_argument("--run-id", required=True, help="DATUM run ID")
    parser.add_argument("--state-dir", default=".datum", help="DATUM state directory")
    args = parser.parse_args()

    state_path = Path(args.state_dir) / "state.json"
    if not state_path.exists():
        print(json.dumps({"error": "no_state", "run_id": args.run_id}))
        sys.exit(1)

    state = json.loads(state_path.read_text())
    phases = state.get("phases", {})

    wait_times: list[dict] = []
    phase_order = [
        "refine",
        "plan",
        "properties",
        "act",
        "validate",
        "review",
        "closeout",
    ]
    for i, phase in enumerate(phase_order[:-1]):
        next_phase = phase_order[i + 1]
        p = phases.get(phase, {})
        n = phases.get(next_phase, {})
        if p.get("completed_at") and n.get("started_at"):
            wait_times.append(
                {
                    "from": phase,
                    "to": next_phase,
                    "completed_at": p["completed_at"],
                    "started_at": n["started_at"],
                }
            )

    print(json.dumps({"run_id": args.run_id, "wait_times": wait_times}, indent=2))


if __name__ == "__main__":
    main()
