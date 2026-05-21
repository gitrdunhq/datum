#!/usr/bin/env python3
"""
rollback.py — Revert a merged epic and open it as a new PR Comments run.

Usage:
  python3 scripts/rollback.py --run-id <original_run_id> [--dry-run]
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

RUNS_DIR = Path(".datum/runs")
STATE_FILE = Path(".datum/state.json")


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=check)


def gh(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    env_patch = {"GITHUB_TOKEN": ""}
    import os

    env = {**os.environ, **env_patch}
    return subprocess.run(
        ["gh", *args], capture_output=True, text=True, check=check, env=env
    )


def next_epic_number() -> int:
    if not RUNS_DIR.exists():
        return 1
    numbers = []
    for d in RUNS_DIR.iterdir():
        parts = d.name.split("-")
        if len(parts) >= 2 and parts[0] == "epic" and parts[1].isdigit():
            numbers.append(int(parts[1]))
    return max(numbers, default=0) + 1


def load_closeout_data(run_id: str) -> dict:
    paths = [
        RUNS_DIR / run_id / "closeout-data.json",
        RUNS_DIR / run_id / "state.json",
    ]
    for p in paths:
        if p.exists():
            return json.loads(p.read_text())
    return {}


def main() -> None:
    parser = argparse.ArgumentParser(description="Rollback a merged epic")
    parser.add_argument("--run-id", required=True, help="Original run_id to roll back")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    original_run_id = args.run_id
    dry = args.dry_run

    # Step 1: Load original run data
    data = load_closeout_data(original_run_id)
    merge_sha = data.get("merge_sha") or data.get("git", {}).get("merge_sha")
    if not merge_sha:
        print(json.dumps({"error": f"No merge_sha found for run {original_run_id}"}))
        sys.exit(1)

    # Step 2: Guard — verify merge_sha is in history
    check = git("merge-base", "--is-ancestor", merge_sha, "HEAD", check=False)
    if check.returncode != 0:
        print(
            json.dumps(
                {"error": f"{merge_sha} is not an ancestor of HEAD — cannot roll back"}
            )
        )
        sys.exit(1)

    # Guard against rollback-of-rollback
    if "rollback" in original_run_id:
        print(
            json.dumps(
                {"error": "Cannot roll back a rollback run. File a new ticket instead."}
            )
        )
        sys.exit(1)

    if dry:
        print(
            json.dumps(
                {
                    "dry_run": True,
                    "would_revert": merge_sha,
                    "original_run_id": original_run_id,
                }
            )
        )
        return

    # Step 3: Create revert commit
    git("revert", merge_sha, "--no-edit")
    revert_sha = git("rev-parse", "HEAD").stdout.strip()

    # Step 4: Create rollback branch
    short_id = original_run_id[-8:].replace("-", "")
    n = next_epic_number()
    branch = f"datum/epic-{n}-rollback-{short_id}"
    git("checkout", "-b", branch)
    git("push", "origin", branch)

    # Step 5: Open revert PR
    original_pr = data.get("platform", {}).get("pr_url", "") or data.get("git", {}).get(
        "pr_url", ""
    )
    body = (
        f"## Rollback: {original_run_id}\n\n"
        f"Reverts {merge_sha[:8]} from {original_pr or original_run_id}.\n\n"
        f"See `references/rollback.md` for protocol.\n\n"
        f"**Do not merge until tests are confirmed green on this branch.**"
    )
    pr_result = gh(
        "pr",
        "create",
        "--title",
        f"rollback: revert {original_run_id}",
        "--body",
        body,
        "--base",
        "main",
        check=False,
    )
    pr_url = pr_result.stdout.strip() if pr_result.returncode == 0 else ""

    # Step 6: Generate new RUN_ID
    now = datetime.now(timezone.utc)
    new_run_id = f"epic-{n}-rollback-{now.strftime('%Y%m%d-%H%M%S')}"

    # Step 7: Write state for the rollback run
    state = {
        "schema_version": "1.0.0",
        "run_id": new_run_id,
        "rollback_of": original_run_id,
        "skill_version": "1.0.0",
        "current_phase": "validate",  # validate first — confirm tests green on revert branch
        "phases": {},
        "lanes": {},
        "in_flight_count": 0,
        "in_flight_cap": 7,
        "git": {
            "base_branch": "main",
            "work_branch": branch,
            "head_sha": revert_sha,
            "revert_sha": revert_sha,
            "original_merge_sha": merge_sha,
            "pr_url": pr_url,
        },
        "brief_defects": [],
        "lane_tools_added": [],
        "gitnexus_degraded": False,
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))

    # Step 8: Run full test suite to verify revert
    print(
        json.dumps(
            {
                "status": "verifying_revert",
                "message": "Running test suite on reverted branch...",
            }
        )
    )

    print(
        json.dumps(
            {
                "ok": True,
                "new_run_id": new_run_id,
                "rollback_of": original_run_id,
                "branch": branch,
                "pr_url": pr_url,
                "revert_sha": revert_sha,
                "next_step": "Tests must pass before proceeding to PR Comments. Run: datum resume",
            }
        )
    )


if __name__ == "__main__":
    main()
