"""Deterministic post-decompose renumber of task-NNN ids to PREFIX-n (task-010)."""

from __future__ import annotations

import re


def _topological_order(tasks: list[dict]) -> list[str]:
    id_set = {t["id"] for t in tasks}
    deps = {t["id"]: [d for d in t.get("depends_on", []) if d in id_set] for t in tasks}

    visited: set[str] = set()
    temp: set[str] = set()
    order: list[str] = []

    def visit(node: str) -> None:
        if node in temp:
            raise ValueError(f"Circular dependency detected involving: {node}")
        if node in visited:
            return
        temp.add(node)
        for dep in deps.get(node, []):
            visit(dep)
        temp.discard(node)
        visited.add(node)
        order.append(node)

    for task in tasks:
        if task["id"] not in visited:
            visit(task["id"])

    return order


def renumber_tasks(tasks: list[dict], prefix: str, start: int) -> list[dict]:
    """Renumber task ids that match ``task-NNN`` to ``PREFIX-n``.

    Assignment follows dependency (topological) order, so a task that is
    depended upon always receives a lower number than any task depending
    on it. Ids already matching ``PREFIX-n`` are left untouched and their
    number is never reissued to another task.
    """
    prefixed_re = re.compile(rf"^{re.escape(prefix)}-(\d+)$")

    reserved: set[int] = set()
    for task in tasks:
        match = prefixed_re.match(task["id"])
        if match:
            reserved.add(int(match.group(1)))

    order = _topological_order(tasks)

    old_to_new: dict[str, str] = {}
    counter = start
    for old_id in order:
        match = prefixed_re.match(old_id)
        if match:
            old_to_new[old_id] = old_id
            continue
        while counter in reserved:
            counter += 1
        new_id = f"{prefix}-{counter}"
        reserved.add(counter)
        old_to_new[old_id] = new_id
        counter += 1

    result: list[dict] = []
    for task in tasks:
        new_task = dict(task)
        old_id = task["id"]
        new_task["id"] = old_to_new.get(old_id, old_id)
        if "depends_on" in task:
            new_task["depends_on"] = [
                old_to_new.get(dep, dep) for dep in task["depends_on"]
            ]
        result.append(new_task)

    return result
