#!/usr/bin/env python3
"""Collect git metrics for this epic."""

import json
import subprocess
from pathlib import Path

MARKER = Path(".datum/runs/.collect-git.done")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True).stdout.strip()


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--base-sha", required=True)
    parser.add_argument("--merge-sha", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.collect-git.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True, "reason": "marker exists"}))
        return

    log_raw = git("log", f"{args.base_sha}..{args.merge_sha}", "--oneline")
    commits = [line for line in log_raw.splitlines() if line]

    diff_stat = git("diff", "--numstat", args.base_sha, args.merge_sha)
    loc_added = loc_removed = 0
    files_touched = []
    for line in diff_stat.splitlines():
        parts = line.split("\t")
        if len(parts) == 3:
            try:
                loc_added += int(parts[0])
                loc_removed += int(parts[1])
            except ValueError:
                pass
            files_touched.append(parts[2])

    data = {
        "commits": commits,
        "commit_count": len(commits),
        "files_touched": files_touched,
        "loc_added": loc_added,
        "loc_removed": loc_removed,
        "loc_net": loc_added - loc_removed,
    }

    out = Path(f".datum/runs/{args.run_id}/closeout-raw/git.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "data": data}))


if __name__ == "__main__":
    main()
