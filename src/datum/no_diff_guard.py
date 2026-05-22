#!/usr/bin/env python3
"""
no_diff_guard.py — Detects two consecutive no-diff attempts and stops the lane early.

When an agent completes a stage but produces no git diff, it either has nothing
to do or is stuck. One no-diff is possibly intentional (investigation task). Two
consecutive no-diffs is a stall and should abort rather than burn the retry budget.

Usage:
  python3 scripts/no_diff_guard.py --lane task-001 --stage GREEN --run-id <id>

Exit codes:
  0 — no stall, proceed
  1 — stall detected (two consecutive no-diffs), halt lane
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def git_diff_stat(base_sha: str, head_sha: str) -> int:
    """Return number of lines changed between two SHAs. 0 = no diff."""
    result = subprocess.run(
        ["git", "diff", "--stat", base_sha, head_sha],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return 0
    # Last line: "N files changed, M insertions(+), K deletions(-)"
    # Return total changed lines as a proxy for "any diff"
    lines = result.stdout.strip().splitlines()
    last = lines[-1] if lines else ""
    import re

    nums = re.findall(r"\d+", last)
    return sum(int(n) for n in nums) if nums else 0


def load_state() -> dict:
    p = Path(".datum/state.json")
    return json.loads(p.read_text()) if p.exists() else {}


def save_state(state: dict) -> None:
    p = Path(".datum/state.json")
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2))
    tmp.replace(p)


def main() -> None:
    parser = argparse.ArgumentParser(description="No-diff stall guard")
    parser.add_argument("--lane", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--before-sha", required=True, help="HEAD before this attempt")
    parser.add_argument("--after-sha", required=True, help="HEAD after this attempt")
    args = parser.parse_args()

    changed = git_diff_stat(args.before_sha, args.after_sha)

    state = load_state()
    lane = state.get("lanes", {}).get(args.lane, {})
    stage_data = lane.get("stages", {}).get(args.stage, {})

    if changed > 0:
        # Diff exists — clear any previous no-diff count
        stage_data.pop("consecutive_no_diff", None)
        state.setdefault("lanes", {}).setdefault(args.lane, {}).setdefault(
            "stages", {}
        )[args.stage] = stage_data
        save_state(state)
        print(json.dumps({"stall": False, "changed_lines": changed}))
        sys.exit(0)

    # No diff — increment counter
    count = stage_data.get("consecutive_no_diff", 0) + 1
    stage_data["consecutive_no_diff"] = count
    state.setdefault("lanes", {}).setdefault(args.lane, {}).setdefault("stages", {})[
        args.stage
    ] = stage_data
    save_state(state)

    if count >= 2:
        # Two consecutive no-diffs — stall detected
        stall_log = Path(f".datum/runs/{args.run_id}/no-diff-stalls.json")
        stall_log.parent.mkdir(parents=True, exist_ok=True)
        entries = json.loads(stall_log.read_text()) if stall_log.exists() else []
        entries.append(
            {
                "lane": args.lane,
                "stage": args.stage,
                "before_sha": args.before_sha,
                "after_sha": args.after_sha,
                "consecutive_count": count,
            }
        )
        stall_log.write_text(json.dumps(entries, indent=2))

        print(
            json.dumps(
                {
                    "stall": True,
                    "consecutive_no_diff": count,
                    "message": f"Lane {args.lane} stage {args.stage}: two consecutive attempts produced no git diff. "
                    "Halting lane early to avoid burning retry budget on a stuck agent. "
                    "Classify as REASONING stall and escalate to fresh Reasoning-tier agent.",
                }
            )
        )
        sys.exit(1)

    print(
        json.dumps(
            {
                "stall": False,
                "consecutive_no_diff": count,
                "warning": "One no-diff — watching",
            }
        )
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
