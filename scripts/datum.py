#!/usr/bin/env python3
# /// script
# dependencies = [
#   "typer",
#   "rich",
#   "pydantic",
# ]
# ///
"""Self-contained execution wrapper for the DATUM agent skill."""

import sys
import runpy
from pathlib import Path

# Ensure the 'datum' package is available
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main():
    # If the first argument starts with 'datum.', act like python -m
    if len(sys.argv) > 1 and sys.argv[1].startswith("datum."):
        module = sys.argv[1]
        sys.argv.pop(0)  # remove the script name
        # Now sys.argv is ['datum.module', 'arg1', ...]
        runpy.run_module(module, run_name="__main__", alter_sys=True)
    else:
        # Otherwise, run the main Typer CLI
        from datum.cli import main as cli_main

        cli_main()


if __name__ == "__main__":
    main()
