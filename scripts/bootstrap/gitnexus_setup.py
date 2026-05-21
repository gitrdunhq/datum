#!/usr/bin/env python3
"""Run GitNexus initial analysis if GitNexus MCP is available."""

import json
import subprocess
import sys


def check_gitnexus() -> bool:
    """Check if gitnexus CLI is available."""
    result = subprocess.run(["gitnexus", "--version"], capture_output=True, text=True)
    return result.returncode == 0


def main() -> None:
    if not check_gitnexus():
        print(
            json.dumps(
                {
                    "ok": True,
                    "skipped": True,
                    "reason": "gitnexus CLI not found — GitNexus MCP integration unavailable. "
                    "Install GitNexus and re-run datum init to enable impact analysis.",
                }
            )
        )
        sys.exit(0)

    result = subprocess.run(
        ["gitnexus", "analyze", "--skills"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "gitnexus analyze failed",
                    "stderr": result.stderr[:500],
                }
            )
        )
        sys.exit(1)

    print(json.dumps({"ok": True, "output": result.stdout[:500]}))


if __name__ == "__main__":
    main()
