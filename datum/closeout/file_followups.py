#!/usr/bin/env python3
"""File follow-up issues to the configured tracker. Idempotent via dedup_key."""

import json
import subprocess
from pathlib import Path

from pydantic import ValidationError

from datum.models.follow_up_schema import FollowUpIssue


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--tracker", default="auto")
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.file-followups.done")
    marker.parent.mkdir(parents=True, exist_ok=True)
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

    invalid: list[dict] = []
    invalid_items: list[dict] = []
    valid_followups: list[dict] = []
    for item in followups:
        try:
            FollowUpIssue(**item)
        except ValidationError as exc:
            invalid.append({"item": item, "errors": exc.errors(include_url=False)})
            invalid_items.append(item)
        else:
            valid_followups.append(item)
    followups = valid_followups

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
    all_items = filed + retained + invalid_items
    followups_path.write_text(json.dumps(all_items, indent=2))

    marker.write_text("done")
    result_payload = {
        "ok": True,
        "filed": len(filed),
        "retained": len(retained),
        "tracker": tracker,
    }
    if invalid:
        result_payload["invalid"] = len(invalid)
        result_payload["invalid_details"] = invalid
    print(json.dumps(result_payload))


if __name__ == "__main__":
    main()
