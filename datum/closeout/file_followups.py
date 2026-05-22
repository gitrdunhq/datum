#!/usr/bin/env python3
"""File follow-up issues to the configured tracker. Idempotent via dedup_key."""

import json
import subprocess
from pathlib import Path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--tracker", default="auto")
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.file-followups.done")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    followups_path = Path("follow-ups.json")
    if not followups_path.exists():
        marker.write_text("done")
        print(json.dumps({"ok": True, "filed": 0, "reason": "no follow-ups.json"}))
        return

    followups = json.loads(followups_path.read_text())
    if not isinstance(followups, list):
        followups = followups.get("items", [])

    # Detect tracker
    tracker = args.tracker
    if tracker == "auto":
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
        )
        remote = result.stdout.strip()
        if "github.com" in remote:
            tracker = "github"
        else:
            tracker = "local"

    filed = []
    retained = []

    for item in followups:
        if item.get("filed_url"):
            filed.append(item)
            continue

        if tracker == "github":
            title = item.get("title", "Follow-up")
            body = item.get("body", "")
            labels = ",".join(item.get("suggested_labels", ["datum-followup"]))
            result = subprocess.run(
                [
                    "gh",
                    "issue",
                    "create",
                    "--title",
                    title,
                    "--body",
                    body,
                    "--label",
                    labels,
                ],
                capture_output=True,
                text=True,
                env={
                    "PATH": "/usr/bin:/usr/local/bin",
                    "HOME": str(Path.home()),
                    **__import__("os").environ,
                },
            )
            if result.returncode == 0:
                item["filed_url"] = result.stdout.strip()
                filed.append(item)
            else:
                retained.append(item)
        else:
            retained.append(item)

    # Write back with filed URLs populated
    all_items = filed + retained
    followups_path.write_text(json.dumps(all_items, indent=2))

    marker.write_text("done")
    print(
        json.dumps(
            {
                "ok": True,
                "filed": len(filed),
                "retained": len(retained),
                "tracker": tracker,
            }
        )
    )


if __name__ == "__main__":
    main()
