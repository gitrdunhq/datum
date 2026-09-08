#!/usr/bin/env python3
"""Collect PR/platform metadata already known to DATUM state."""

from __future__ import annotations

import argparse
import json

from datum.closeout.state_source import load_run_state
from datum.path_utils import closeout_raw_dir, collector_marker


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = collector_marker(args.run_id, "platform")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    state, state_source = load_run_state(args.run_id)
    git = state.get("git", {})
    data = {
        "pr_url": git.get("pr_url"),
        "pr_author_login": git.get("pr_author_login"),
        "merge_sha": git.get("merge_sha"),
        "work_branch": git.get("work_branch"),
        "source": state_source,
    }

    out = closeout_raw_dir(args.run_id) / "platform.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "data": data}))


if __name__ == "__main__":
    main()
