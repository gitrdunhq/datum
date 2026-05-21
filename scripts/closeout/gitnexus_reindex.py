#!/usr/bin/env python3
"""Trigger GitNexus reindex after closeout. Non-blocking."""

import json
import subprocess
from pathlib import Path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    log_path = Path(f".datum/runs/{args.run_id}/gitnexus-reindex.log")
    log_path.parent.mkdir(parents=True, exist_ok=True)

    result = subprocess.run(
        ["gitnexus", "analyze"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    log_path.write_text(result.stdout + result.stderr)

    if result.returncode != 0:
        print(
            json.dumps({"ok": False, "error": "reindex failed", "log": str(log_path)})
        )
    else:
        print(json.dumps({"ok": True, "log": str(log_path)}))


if __name__ == "__main__":
    main()
