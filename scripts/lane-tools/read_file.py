#!/usr/bin/env python3
import sys
import json
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        print("Usage: read_file.py <json_args>")
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

    target = Path(path_str).resolve()
    if not target.is_file():
        print(f"Error: File '{target}' does not exist or is not a file.")
        sys.exit(1)

    try:
        print(target.read_text(encoding="utf-8"), end="")
    except Exception as e:
        print(f"Error reading file '{target}': {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
