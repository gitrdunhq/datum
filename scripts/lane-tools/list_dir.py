#!/usr/bin/env python3
import sys
import json
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        print("Usage: list_dir.py <json_args>")
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print("Error: Arguments must be a JSON object.")
        sys.exit(1)

    path_str = args.get("path", ".")
    target = Path(path_str).resolve()
    if not target.is_dir():
        print(f"Error: '{target}' does not exist or is not a directory.")
        sys.exit(1)

    try:
        entries = sorted(target.iterdir())
        for entry in entries:
            kind = "d" if entry.is_dir() else "f"
            print(f"[{kind}] {entry.name}")
    except Exception as e:
        print(f"Error listing directory '{target}': {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
