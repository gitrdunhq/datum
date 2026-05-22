#!/usr/bin/env python3
"""
Archive DATUM artifacts to .datum/runs/<RUN_ID>/.

Usage:
  python3 scripts/archive.py <run_id> <artifact_path> [<artifact_path>...]
  python3 scripts/archive.py --run-id <run_id> --phase <phase>
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

RUNS_DIR = Path(".datum/runs")

PHASE_ARTIFACTS: dict[str, list[str]] = {
    "refine": ["SPEC.md"],
    "plan": ["TASKS.md", ".datum/lane-plan.json"],
    "properties": ["PROPERTIES.md"],
    "act": [],  # per-lane commits are archived via commit queue
    "validate": [".datum/last-test-signal.json"],
    "review": ["REVIEW-REPORT.md"],
    "pr_comments": [".datum/triage.json"],
    "closeout": [
        "CURRENT_STATE.md",
        "ROADMAP.md",
        "CHANGELOG.md",
        "RETRO.md",
        "solutions/",
        "follow-ups.json",
    ],
}


def archive_files(run_id: str, paths: list[Path]) -> dict:
    archive_dir = RUNS_DIR / run_id
    archive_dir.mkdir(parents=True, exist_ok=True)

    archived = []
    errors = []

    for src in paths:
        if not src.exists():
            errors.append(f"Not found: {src}")
            continue
        dest = archive_dir / src.name
        if src.is_dir():
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest)
        else:
            shutil.copy2(src, dest)
        archived.append(str(src))

    return {
        "ok": True,
        "archived": archived,
        "errors": errors,
        "archive_dir": str(archive_dir),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Archive DATUM phase artifacts")
    parser.add_argument("run_id", nargs="?")
    parser.add_argument("artifacts", nargs="*")
    parser.add_argument("--run-id")
    parser.add_argument("--phase")
    args = parser.parse_args()

    run_id = args.run_id or args.run_id
    if not run_id:
        # Try to read from state
        state_path = Path(".datum/state.json")
        if state_path.exists():
            with state_path.open() as f:
                state = json.load(f)
            run_id = state.get("run_id")
    if not run_id:
        print(json.dumps({"error": "No run_id provided and no state.json found"}))
        sys.exit(1)

    import re
    if not re.match(r"^[a-zA-Z0-9_-]+$", run_id):
        print(json.dumps({"error": "Invalid run_id format"}))
        sys.exit(1)

    if args.phase:
        artifact_names = PHASE_ARTIFACTS.get(args.phase, [])
        paths = [Path(a) for a in artifact_names]
    else:
        paths = [Path(a) for a in args.artifacts]

    if not paths:
        print(json.dumps({"ok": True, "archived": [], "message": "Nothing to archive"}))
        return

    result = archive_files(run_id, paths)
    print(json.dumps(result, indent=2))
    if result["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
