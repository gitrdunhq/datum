#!/usr/bin/env python3
"""Lane tool: replace the first occurrence of old_text with new_text in a file."""

import json
import sys
from pathlib import Path


def main() -> None:
    """Replace the first occurrence of old_text with new_text in a file.

    Args (JSON via sys.argv[1]):
        path (str): Target file path.
        old_text (str): Exact text to search for (must be present).
        new_text (str): Replacement text.

    Prints:
        On success: JSON with ``path`` and ``ok=true``.
        On error: plain error string to stdout, exits non-zero.
        Exits non-zero if ``old_text`` is not found — file is never modified.
    """
    if len(sys.argv) < 2:
        print("Usage: replace_file_content.py <json_args>")
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print("Error: Arguments must be a JSON object.")
        sys.exit(1)

    path_str = args.get("path")
    if not path_str:
        print("Error: 'path' argument is required.")
        sys.exit(1)

    old_text = args.get("old_text")
    if old_text is None:
        print("Error: 'old_text' argument is required.")
        sys.exit(1)

    new_text = args.get("new_text")
    if new_text is None:
        print("Error: 'new_text' argument is required.")
        sys.exit(1)

    target = Path(path_str).resolve()
    if not target.is_file():
        print(f"Error: File '{target}' does not exist or is not a file.")
        sys.exit(1)

    try:
        original = target.read_text(encoding="utf-8")
    except Exception as e:
        print(f"Error reading file '{target}': {e}")
        sys.exit(1)

    if old_text not in original:
        print(f"Error: 'old_text' not found in '{target}'.")
        sys.exit(1)

    updated = original.replace(old_text, new_text, 1)

    try:
        target.write_text(updated, encoding="utf-8")
        print(json.dumps({"path": str(target), "ok": True}))
    except Exception as e:
        print(f"Error writing file '{target}': {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
