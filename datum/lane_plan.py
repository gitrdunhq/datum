#!/usr/bin/env python3
"""
Builds lane-plan.json and TASKS.md from tasks.json.

Usage:
  python3 scripts/lane_plan.py [--validate] [--input tasks.json] [--output .datum/lane-plan.json]
"""

import argparse
import json
import sys
from pathlib import Path


def validate_json_schema(data: list, schema_path: Path):
    """Validate data against JSON schema if jsonschema is available."""
    try:
        import jsonschema

        with schema_path.open() as f:
            schema = json.load(f)
        # Handle relative $ref in items
        if "items" in schema and "$ref" in schema["items"]:
            # This is a bit simplified, but works for our repo structure
            ref_path = schema_path.parent / schema["items"]["$ref"]
            with ref_path.open() as f:
                ref_schema = json.load(f)
            schema["items"] = ref_schema

        jsonschema.validate(instance=data, schema=schema)
        return True, []
    except ImportError:
        # Fallback to basic validation if jsonschema not installed
        errors = []
        for i, task in enumerate(data):
            for field in ["id", "title", "acceptance_criteria", "files", "red_note"]:
                if field not in task:
                    errors.append(
                        f"Task {i} ({task.get('id', 'unknown')}): missing {field}"
                    )
        return len(errors) == 0, errors
    except Exception as e:
        return False, [str(e)]


def normalize_input(raw: list | dict) -> tuple[list[dict], dict]:
    """Dispatch plain list (legacy) vs object-with-units format.

    Returns (tasks_list, units_dict).  When *raw* is a plain list the
    units dict is empty, preserving backward compatibility.
    """
    if isinstance(raw, list):
        return raw, {}
    if isinstance(raw, dict):
        tasks = raw.get("tasks", [])
        units = raw.get("units", {})
        return tasks, units
    raise TypeError(f"Expected list or dict, got {type(raw).__name__}")


def validate_units(units: dict, task_ids: set[str]) -> list[str]:
    """Validate unit definitions against the known task IDs.

    Checks:
    1. Every task referenced in a unit exists in *task_ids*.
    2. Every unit referenced in *depends_on* exists in *units*.

    Returns a list of human-readable error strings (empty == valid).
    """
    errors: list[str] = []
    unit_ids = set(units.keys())

    for uid, unit in units.items():
        for tid in unit.get("tasks", []):
            if tid not in task_ids:
                errors.append(f"Unit '{uid}' references unknown task '{tid}'")
        for dep in unit.get("depends_on", []):
            if dep not in unit_ids:
                errors.append(f"Unit '{uid}' depends on unknown unit '{dep}'")
    return errors


def topological_sort_units(units: dict) -> list[str]:
    """Return unit IDs in topological order. Raises on cycle."""
    deps = {uid: u.get("depends_on", []) for uid, u in units.items()}
    visited: set[str] = set()
    temp: set[str] = set()
    order: list[str] = []

    def visit(node: str) -> None:
        if node in temp:
            raise ValueError(f"Circular unit dependency detected involving: {node}")
        if node in visited:
            return
        temp.add(node)
        for dep in deps.get(node, []):
            visit(dep)
        temp.discard(node)
        visited.add(node)
        order.append(node)

    for uid in units:
        if uid not in visited:
            visit(uid)

    return order


def build_file_ownership(
    tasks: list[dict],
) -> tuple[dict[str, str], dict[str, list[str]]]:
    """Map each file to its owning lane. Detect conflicts."""
    ownership: dict[str, str] = {}
    conflicts: dict[str, list[str]] = {}

    for task in tasks:
        for f in task["files"]:
            if f in ownership:
                conflicts.setdefault(f, [ownership[f]]).append(task["id"])
            else:
                ownership[f] = task["id"]

    return ownership, conflicts


def topological_sort(tasks: list[dict]) -> list[str]:
    """Return task IDs in topological order. Raises on cycle."""
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


def _render_task_block(task: dict) -> list[str]:
    """Render a single task as markdown lines."""
    lines: list[str] = []
    lines.append(f"### {task['id']}: {task['title']}")
    if task.get("description"):
        lines.append(f"{task['description']}")
        lines.append("")

    lines.append("- **Acceptance Criteria**:")
    for ac in task["acceptance_criteria"]:
        lines.append(f"  - {ac}")

    lines.append(f"- **Files**: {', '.join(task['files'])}")

    if task.get("depends_on"):
        lines.append(f"- **Depends on**: {', '.join(task['depends_on'])}")

    lines.append(f"- **RED Note**: {task['red_note']}")

    if task.get("introduces_stubs"):
        lines.append("- **Introduces Stubs**: true")

    if task.get("estimated_loc"):
        lines.append(f"- **Estimated LOC**: {task['estimated_loc']}")

    lines.append("")
    return lines


def render_tasks_md(
    tasks: list[dict], sorted_ids: list[str], units: dict | None = None
) -> str:
    """Render a human-readable TASKS.md from the task list.

    When *units* is provided and non-empty, tasks are grouped under
    unit section headers with dependency annotations.  Tasks not
    assigned to any unit appear under an "Ungrouped Tasks" section.
    """
    task_map = {t["id"]: t for t in tasks}
    lines = ["# Implementation Plan (TASKS.md)", ""]

    lines.append("## Dependency Graph")
    lines.append("```mermaid")
    lines.append("graph TD")
    for tid in sorted_ids:
        task = task_map[tid]
        for dep in task.get("depends_on", []):
            lines.append(f"  {dep} --> {tid}")
    lines.append("```")
    lines.append("")

    if units:
        # Build set of tasks already assigned to a unit
        assigned: set[str] = set()
        for unit in units.values():
            assigned.update(unit.get("tasks", []))

        # Render unit sections in topological order of units
        unit_pseudo_tasks = [
            {"id": uid, "depends_on": u.get("depends_on", [])}
            for uid, u in units.items()
        ]
        try:
            unit_order = topological_sort(unit_pseudo_tasks)
        except ValueError:
            # Cycle should have been caught earlier; fallback to dict order
            unit_order = list(units.keys())

        for uid in unit_order:
            unit = units[uid]
            dep_note = ""
            if unit.get("depends_on"):
                dep_note = f" (depends on: {', '.join(unit['depends_on'])})"
            lines.append(f"## {uid}: {unit['name']}{dep_note}")
            lines.append("")
            unit_task_ids = [
                tid for tid in sorted_ids if tid in set(unit.get("tasks", []))
            ]
            for tid in unit_task_ids:
                lines.extend(_render_task_block(task_map[tid]))

        # Ungrouped tasks
        ungrouped = [tid for tid in sorted_ids if tid not in assigned]
        if ungrouped:
            lines.append("## Ungrouped Tasks")
            lines.append("")
            for tid in ungrouped:
                lines.extend(_render_task_block(task_map[tid]))
    else:
        # Legacy: flat list, no unit grouping (use ## for tasks like before)
        for tid in sorted_ids:
            task = task_map[tid]
            lines.append(f"## {task['id']}: {task['title']}")
            if task.get("description"):
                lines.append(f"{task['description']}")
                lines.append("")

            lines.append("- **Acceptance Criteria**:")
            for ac in task["acceptance_criteria"]:
                lines.append(f"  - {ac}")

            lines.append(f"- **Files**: {', '.join(task['files'])}")

            if task.get("depends_on"):
                lines.append(f"- **Depends on**: {', '.join(task['depends_on'])}")

            lines.append(f"- **RED Note**: {task['red_note']}")

            if task.get("introduces_stubs"):
                lines.append("- **Introduces Stubs**: true")

            if task.get("estimated_loc"):
                lines.append(f"- **Estimated LOC**: {task['estimated_loc']}")

            lines.append("")

    return "\n".join(lines)


def build_lane_plan(
    tasks: list[dict],
    sorted_ids: list[str],
    ownership: dict,
    units: dict | None = None,
) -> dict:
    """Build the full lane-plan.json structure."""
    task_map = {t["id"]: t for t in tasks}

    lanes = {}
    for tid in sorted_ids:
        task = task_map[tid]

        write_conflicts = {}
        for f in task["files"]:
            owner = ownership.get(f)
            if owner and owner != tid:
                write_conflicts[f] = owner

        lanes[tid] = {
            "id": tid,
            "title": task["title"],
            "files": task["files"],
            "acceptance_criteria": task["acceptance_criteria"],
            "red_note": task["red_note"],
            "introduces_stubs": task.get("introduces_stubs", False),
            "estimated_loc": task.get("estimated_loc", 0),
            "depends_on": task.get("depends_on", []),
            "file_conflict_with": write_conflicts,
            "stage": "queued",
        }

    result = {
        "schema_version": "1.0.0",
        "total_lanes": len(lanes),
        "topological_order": sorted_ids,
        "file_ownership": ownership,
        "lanes": lanes,
    }
    if units:
        result["units"] = units
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build lane-plan.json and TASKS.md from tasks.json"
    )
    parser.add_argument("--validate", action="store_true")
    parser.add_argument("--input", default="tasks.json")
    parser.add_argument("--output", default=".datum/lane-plan.json")
    parser.add_argument("--md-output", default="TASKS.md")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(json.dumps({"error": f"{args.input} not found"}))
        sys.exit(1)

    try:
        raw = json.loads(input_path.read_text())
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Failed to parse {args.input}: {str(e)}"}))
        sys.exit(1)

    tasks, units = normalize_input(raw)

    sys.path.insert(0, str(Path(__file__).parent))
    from path_utils import assets_dir

    schema_path = assets_dir() / "schemas/tasks.schema.json"
    valid, errors = validate_json_schema(tasks, schema_path)

    if not valid:
        print(json.dumps({"error": "Schema validation failed", "details": errors}))
        sys.exit(1)

    if units:
        task_ids = {t["id"] for t in tasks}
        unit_errors = validate_units(units, task_ids)
        if unit_errors:
            print(
                json.dumps({"error": "Unit validation failed", "details": unit_errors})
            )
            sys.exit(1)

        try:
            topological_sort_units(units)
        except ValueError as e:
            print(json.dumps({"error": str(e)}))
            sys.exit(1)

    if args.validate:
        try:
            topological_sort(tasks)
            print(json.dumps({"valid": True, "task_count": len(tasks)}))
        except ValueError as e:
            print(json.dumps({"valid": False, "error": str(e)}))
            sys.exit(1)
        return

    try:
        sorted_ids = topological_sort(tasks)
    except ValueError as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

    ownership, _ = build_file_ownership(tasks)
    lane_plan = build_lane_plan(tasks, sorted_ids, ownership, units)

    # Write lane-plan.json
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w") as f:
        json.dump(lane_plan, f, indent=2)

    # Write TASKS.md
    md_content = render_tasks_md(tasks, sorted_ids, units if units else None)
    Path(args.md_output).write_text(md_content)

    print(
        json.dumps(
            {
                "ok": True,
                "lane_plan": args.output,
                "tasks_md": args.md_output,
                "total_lanes": lane_plan["total_lanes"],
            }
        )
    )


if __name__ == "__main__":
    main()
