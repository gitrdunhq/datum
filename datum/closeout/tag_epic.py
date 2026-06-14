#!/usr/bin/env python3
"""Apply git tag to the merge commit. Idempotent — skips if tag exists."""

import json
import subprocess
import sys
from datetime import UTC, datetime, timezone
from pathlib import Path


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--epic-number", type=int, required=True)
    parser.add_argument("--merge-sha", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.tag-epic.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    date_str = datetime.now(UTC).strftime("%Y%m%d")
    tag_name = f"closeout-epic-{args.epic_number}-{date_str}"

    # Check if tag already exists
    existing = git("tag", "-l", tag_name).stdout.strip()
    if existing:
        marker.write_text("done")
        print(
            json.dumps(
                {
                    "ok": True,
                    "skipped": True,
                    "tag": tag_name,
                    "reason": "tag already exists",
                }
            )
        )
        return

    result = git("tag", tag_name, args.merge_sha)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr[:300]}))
        sys.exit(1)

    marker.write_text("done")
    print(json.dumps({"ok": True, "tag": tag_name, "sha": args.merge_sha}))


if __name__ == "__main__":
    main()
