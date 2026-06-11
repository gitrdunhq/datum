#!/usr/bin/env python3
"""Lane tool: persist the agent todo list to .datum/todos.json under cwd (#70).

Validation lives in datum.todos.write_todos — a ValueError there becomes a
clean error string on stdout (exit 1), never a traceback in the observation.
"""

import json
import sys

from datum.todos import write_todos

TODOS_PATH = ".datum/todos.json"


def main() -> None:
    """Validate and persist the todo list.

    Args (JSON via sys.argv[1]):
        items (list[dict]): [{"task": str non-empty, "done": bool}, ...].

    Prints:
        On success: the persisted payload as compact JSON ({"items": [...]}).
        On error: plain error string to stdout, exits non-zero.
    """
    if len(sys.argv) < 2:
        print("Usage: write_todos.py <json_args>")
        sys.exit(1)

    try:
        args = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        print("Error: Arguments must be a JSON object.")
        sys.exit(1)

    items = args.get("items")
    if not isinstance(items, list):
        print(
            "Error: 'items' argument is required and must be a list: "
            '{"items": [{"task": "...", "done": false}]}.'
        )
        sys.exit(1)

    try:
        payload = write_todos(items, TODOS_PATH)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except OSError as e:
        print(f"Error writing '{TODOS_PATH}': {e}")
        sys.exit(1)

    print(json.dumps(payload, separators=(",", ":")))


if __name__ == "__main__":
    main()
