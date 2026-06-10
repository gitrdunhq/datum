#!/usr/bin/env python3
"""Lane tool: write content to a file, creating parent directories as needed."""

import json
import sys
from pathlib import Path


def main() -> None:
    """Write content to a file.

    Args (JSON via sys.argv[1]):
        path (str): Destination file path (absolute or relative to cwd).
        content (str): Text content to write.

    Prints:
        On success: JSON with ``path``, ``bytes_written``, and ``ok=true``.
        On error: plain error string to stdout, exits non-zero.
    """
    if len(sys.argv) < 2:
        print("Usage: write_to_file.py <json_args>")
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

    content = args.get("content")
    if content is None:
        print("Error: 'content' argument is required.")
        sys.exit(1)

    target = Path(path_str).resolve()

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        byte_count = len(content.encode("utf-8"))
        print(
            json.dumps({"path": str(target), "bytes_written": byte_count, "ok": True})
        )
    except Exception as e:
        print(f"Error writing file '{target}': {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
