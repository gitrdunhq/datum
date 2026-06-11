"""Todo persistence core for the agent planning tool (#70)."""

from __future__ import annotations

import json
from pathlib import Path

def write_todos(items, path):
    checked = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError(f"todo item must be a dict: {item!r}")
        task = item.get("task")
        done = item.get("done")
        if not isinstance(task, str) or not task:
            raise ValueError(f"todo task must be a non-empty string: {item!r}")
        if not isinstance(done, bool):
            raise ValueError(f"todo done must be a bool: {item!r}")
        checked.append({"task": task, "done": done})
    payload = {"items": checked}
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload

def read_todos(path):
    p = Path(path)
    if not p.exists():
        return {"items": []}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"items": []}
    if not isinstance(data, dict) or not isinstance(data.get("items"), list):
        return {"items": []}
    items = [
        {"task": i["task"], "done": i["done"]}
        for i in data["items"]
        if isinstance(i, dict)
        and isinstance(i.get("task"), str)
        and i.get("task")
        and isinstance(i.get("done"), bool)
    ]
    return {"items": items}
