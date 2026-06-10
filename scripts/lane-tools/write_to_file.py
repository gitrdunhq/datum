#!/usr/bin/env python3
import sys
import json
from pathlib import Path


def main():
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
