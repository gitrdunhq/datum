#!/usr/bin/env python3
"""Collect GitNexus closeout metadata when GitNexus is available."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from path_utils import collector_marker, closeout_raw_dir  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--base-sha")
    parser.add_argument("--merge-sha")
    args = parser.parse_args()

    marker = collector_marker(args.run_id, "gitnexus-diff")
    if marker.exists():
        print(json.dumps({"ok": True, "skipped": True}))
        return

    gitnexus = shutil.which("gitnexus")
    if not gitnexus:
        data = {
            "available": False,
            "reason": "gitnexus executable not found",
            "base_sha": args.base_sha,
            "merge_sha": args.merge_sha,
        }
    else:
        version = subprocess.run(
            [gitnexus, "--version"], capture_output=True, text=True, check=False
        )
        data = {
            "available": True,
            "version": (version.stdout or version.stderr).strip(),
            "base_sha": args.base_sha,
            "merge_sha": args.merge_sha,
            "note": "Impact details are collected by the orchestrator when GitNexus MCP is available.",
        }

    out = closeout_raw_dir(args.run_id) / "gitnexus_diff.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2))
    marker.write_text("done")
    print(json.dumps({"ok": True, "available": data["available"]}))


if __name__ == "__main__":
    main()
