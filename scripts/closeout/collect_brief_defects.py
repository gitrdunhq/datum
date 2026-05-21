#!/usr/bin/env python3
"""Collect brief defects surfaced during ACT."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from path_utils import collector_marker, closeout_raw_dir, state_for_run  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    marker = collector_marker(args.run_id, "brief-defects")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    state_path = state_for_run(args.run_id)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    defects = state.get("brief_defects", [])

    out = closeout_raw_dir(args.run_id) / "brief_defects.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(defects, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "count": len(defects)}))


if __name__ == "__main__":
    main()
