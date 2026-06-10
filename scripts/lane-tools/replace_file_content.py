#!/usr/bin/env python3
import sys
import json
from pathlib import Path


def main():
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
