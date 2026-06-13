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
import os
from pathlib import Path

# Check if execution directory matches invocation directory
_script_dir = Path(__file__).resolve().parent.parent
_cwd = Path.cwd().resolve()
if _cwd != _script_dir and _script_dir not in _cwd.parents:
    print(f"\n[bold yellow]WARNING: Executing datum from a different directory than cwd![/bold yellow]", file=sys.stderr)
    print(f"  Executed copy: {_script_dir}", file=sys.stderr)
    print(f"  Invoked from:  {Path.cwd()}", file=sys.stderr)
    print("  (If these are separate copies, uv may have resolved the wrong environment across symlinks/paths)\n", file=sys.stderr)

# Ensure the 'datum' package is available
sys.path.insert(0, str(_script_dir))


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
