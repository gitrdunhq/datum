#!/usr/bin/env python3
"""Lane tool: read the agent todo list from .datum/todos.json under cwd (#70).

Read-only: a missing or malformed file yields {"items": []} — never an error,
never a file creation. Validation/normalization lives in datum.todos.
"""

import json

from datum.todos import read_todos

TODOS_PATH = ".datum/todos.json"


def main() -> None:
    """Print the current todo list as compact JSON.

    Args (JSON via sys.argv[1]): none — the path is fixed per issue #70.

    Prints:
        Compact JSON: {"items": [{"task": str, "done": bool}, ...]}.
    """
    print(json.dumps(read_todos(TODOS_PATH), separators=(",", ":")))


if __name__ == "__main__":
    main()
