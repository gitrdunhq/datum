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
    # Only findings at or above this severity open tracker issues; the rest
    # stay in the run manifest (caliper: keep the tracker quiet, keep the data).
    parser.add_argument("--min-severity", default="high", choices=["critical", "high", "medium", "low", "info"])
    args = parser.parse_args()

    marker = Path(f".datum/runs/{args.run_id}/.file-followups.done")
    marker.parent.mkdir(parents=True, exist_ok=True)
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    # Sources, all under the run directory: the synthesis agent's manifest
    # (skills/src/prompts/closeout-synthesize.md) and one file per lane the
    # Act phase wrote for skeptic minority findings (datum-tdd-act-lane.ts).
    run_dir = marker.parent
    followups_path = run_dir / "follow-ups.json"
    followups: list = []
    if followups_path.exists():
        loaded = json.loads(followups_path.read_text())
        followups.extend(loaded if isinstance(loaded, list) else loaded.get("items", []))
    lane_dir = run_dir / "follow-ups"
    if lane_dir.is_dir():
        for lane_file in sorted(lane_dir.glob("*.json")):
            loaded = json.loads(lane_file.read_text())
            followups.extend(loaded if isinstance(loaded, list) else loaded.get("items", []))
    if not followups:
        marker.write_text("done")
        print(json.dumps({"ok": True, "filed": 0, "reason": "no follow-ups"}))
        return
    # dedup_key is the idempotency key across sources and re-runs.
    seen: set = set()
    unique: list = []
    for item in followups:
        key = item.get("dedup_key") if isinstance(item, dict) else None
        if key is not None:
            if key in seen:
                continue
            seen.add(key)
        unique.append(item)
    followups = unique

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
    retained_below_threshold = []
    rank = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    threshold = rank[args.min_severity]

    for item in followups:
        if item.get("filed_url"):
            filed.append(item)
            continue

        if rank.get(str(item.get("severity")), 99) > threshold:
            retained_below_threshold.append(item)
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
    all_items = filed + retained + retained_below_threshold + invalid_items
    followups_path.write_text(json.dumps(all_items, indent=2))

    marker.write_text("done")
    result_payload = {
        "ok": True,
        "filed": len(filed),
        "retained": len(retained),
        "retained_below_threshold": len(retained_below_threshold),
        "min_severity": args.min_severity,
        "manifest": str(followups_path),
        "tracker": tracker,
    }
    if invalid:
        result_payload["invalid"] = len(invalid)
        result_payload["invalid_details"] = invalid
    print(json.dumps(result_payload))


if __name__ == "__main__":
    main()
