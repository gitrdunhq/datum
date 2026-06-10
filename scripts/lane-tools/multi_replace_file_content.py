#!/usr/bin/env python3
import sys
import json
from pathlib import Path


def main():
    if len(sys.argv) < 2:
        print("Usage: multi_replace_file_content.py <json_args>")
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

    replacements = args.get("replacements")
    if replacements is None:
        print("Error: 'replacements' argument is required.")
        sys.exit(1)

    if not isinstance(replacements, list):
        print("Error: 'replacements' must be a list.")
        sys.exit(1)

    target = Path(path_str).resolve()
    if not target.is_file():
        print(f"Error: File '{target}' does not exist or is not a file.")
        sys.exit(1)

    try:
        content = target.read_text(encoding="utf-8")
    except Exception as e:
        print(f"Error reading file '{target}': {e}")
        sys.exit(1)

    # Apply replacements sequentially in list order
    for i, replacement in enumerate(replacements):
        if not isinstance(replacement, dict):
            print(
                f"Error: replacement[{i}] must be a dict with 'old_text' and 'new_text'."
            )
            sys.exit(1)
        old_text = replacement.get("old_text")
        new_text = replacement.get("new_text")
        if old_text is None or new_text is None:
            print(f"Error: replacement[{i}] must have 'old_text' and 'new_text' keys.")
            sys.exit(1)
        if old_text not in content:
            print(f"Error: 'old_text' from replacement[{i}] not found in '{target}'.")
            sys.exit(1)
        content = content.replace(old_text, new_text, 1)

    try:
        target.write_text(content, encoding="utf-8")
        print(
            json.dumps(
                {
                    "path": str(target),
                    "replacements_applied": len(replacements),
                    "ok": True,
                }
            )
        )
    except Exception as e:
        print(f"Error writing file '{target}': {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
