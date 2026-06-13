#!/usr/bin/env python3
"""Commit synthesis artifacts to main. Idempotent."""

import json
import subprocess
import sys
from pathlib import Path

SYNTHESIS_FILES = [
    "CURRENT_STATE.md",
    "ROADMAP.md",
    "CHANGELOG.md",
    "RETRO.md",
    "solutions/",
]


def git(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.commit-closeout.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    # Check if a closeout commit already exists
    log = git(
        "log", "--oneline", "--grep", f"closeout: {args.run_id}", "-1"
    ).stdout.strip()
    if log:
        marker.write_text("done")
        print(
            json.dumps(
                {
                    "ok": True,
                    "skipped": True,
                    "reason": "closeout commit already exists",
                }
            )
        )
        return

    staged = []
    for f in SYNTHESIS_FILES:
        p = Path(f)
        if p.exists():
            git("add", str(p))
            staged.append(f)

    if not staged:
        print(
            json.dumps(
                {"ok": True, "skipped": True, "reason": "no synthesis files to commit"}
            )
        )
        return

    result = git(
        "commit",
        "-m",
        f"closeout: {args.run_id}\n\nPost-epic documentation and state update.\n\nDATUM-Closeout: {args.run_id}",
    )
    if result.returncode != 0:
        err_out = result.stderr + result.stdout
        if "guard-main-commit" in err_out or "Direct commits" in err_out:
            branch_name = f"chore/{args.run_id}-closeout"
            git("checkout", "-b", branch_name)
            res_commit = git(
                "commit",
                "-m",
                f"closeout: {args.run_id}\n\nPost-epic documentation and state update.\n\nDATUM-Closeout: {args.run_id}",
            )
            if res_commit.returncode != 0:
                print(json.dumps({"ok": False, "error": res_commit.stderr[:300]}))
                sys.exit(1)
            
            git("push", "-u", "origin", branch_name)
            subprocess.run(
                ["gh", "pr", "create", "--title", f"Closeout: {args.run_id}", "--body", f"Automated closeout PR for {args.run_id}"],
                capture_output=True,
                text=True
            )
            
            marker.write_text("done")
            print(json.dumps({"ok": True, "pr_created": True, "branch": branch_name, "files": staged}))
            return

        print(json.dumps({"ok": False, "error": result.stderr[:300]}))
        sys.exit(1)

    sha = git("rev-parse", "HEAD").stdout.strip()
    marker.write_text("done")
    print(json.dumps({"ok": True, "sha": sha, "files": staged}))


if __name__ == "__main__":
    main()
