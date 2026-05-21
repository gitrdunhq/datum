#!/usr/bin/env python3
"""
Normalize tool-specific edit outputs to unified diff format for the commit queue.

Usage:
  python3 scripts/diff_normalize.py --tool claude-code --input <edit_log>
  python3 scripts/diff_normalize.py --scratch <scratch_dir> --original <original_dir>
"""

import argparse
import subprocess
import sys
from pathlib import Path


def scratch_to_unified(scratch_dir: Path, original_dir: Path) -> str:
    """Diff scratch (modified) against original to produce unified diff."""
    result = subprocess.run(
        ["diff", "-u", "-r", str(original_dir), str(scratch_dir)],
        capture_output=True,
        text=True,
    )
    # diff exits 1 when differences found, 2 on error
    if result.returncode == 2:
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return result.stdout


def str_replace_to_unified(input_path: Path) -> str:
    """Convert str_replace log to unified diff. Expects JSON lines with old/new/file."""
    import json

    lines = input_path.read_text().splitlines()
    patches: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        entry = json.loads(line)
        file_path = entry.get("file", "unknown")
        old = entry.get("old", "")
        new = entry.get("new", "")
        # Build minimal unified diff hunk
        old_lines = old.splitlines(keepends=True)
        new_lines = new.splitlines(keepends=True)
        import difflib

        diff = list(
            difflib.unified_diff(
                old_lines, new_lines, fromfile=f"a/{file_path}", tofile=f"b/{file_path}"
            )
        )
        patches.append("".join(diff))
    return "\n".join(patches)


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize edits to unified diff")
    parser.add_argument(
        "--tool", choices=["claude-code", "codex", "opencode", "kiro", "gemini-cli"]
    )
    parser.add_argument("--input")
    parser.add_argument("--scratch")
    parser.add_argument("--original")
    parser.add_argument("--output", help="Output file (default: stdout)")
    args = parser.parse_args()

    patch = ""
    if args.scratch and args.original:
        patch = scratch_to_unified(Path(args.scratch), Path(args.original))
    elif args.input and args.tool in ("claude-code", "codex"):
        patch = str_replace_to_unified(Path(args.input))
    else:
        patch = sys.stdin.read()

    if args.output:
        Path(args.output).write_text(patch)
    else:
        print(patch, end="")


if __name__ == "__main__":
    main()
