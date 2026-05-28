#!/usr/bin/env python3
import sys
import json
import re
from pathlib import Path

MAX_RESULTS = 50


def main():
    if len(sys.argv) < 2:
        print("Usage: grep_search.py <json_args>")
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print("Error: Arguments must be a JSON object.")
        sys.exit(1)

    pattern = args.get("pattern")
    if not pattern:
        print("Error: 'pattern' argument is required.")
        sys.exit(1)

    search_path = Path(args.get("path", ".")).resolve()
    include = args.get("include", "")

    try:
        regex = re.compile(pattern)
    except re.error as e:
        print(f"Error: Invalid regex pattern: {e}")
        sys.exit(1)

    count = 0
    try:
        glob_pattern = include if include else "**/*"
        for fpath in sorted(
            search_path.rglob(glob_pattern)
            if not include
            else search_path.glob(include)
        ):
            if not fpath.is_file():
                continue
            if fpath.suffix in (".pyc", ".so", ".whl", ".egg-info"):
                continue
            try:
                for i, line in enumerate(
                    fpath.open("r", encoding="utf-8", errors="replace"), 1
                ):
                    if regex.search(line):
                        rel = fpath.relative_to(search_path)
                        print(f"{rel}:{i}: {line.rstrip()}")
                        count += 1
                        if count >= MAX_RESULTS:
                            print(f"\n... (stopped at {MAX_RESULTS} results)")
                            return
            except (OSError, UnicodeDecodeError):
                continue
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

    if count == 0:
        print(f"No matches for '{pattern}'")


if __name__ == "__main__":
    main()
