"""Parse the '## Integration Invariants' table out of PROPERTIES.md."""

from __future__ import annotations

import re

HEADING = "## Integration Invariants"
EXPECTED_COLUMNS = ["ID", "Invariant", "Covers", "Source"]
SOURCE_PATTERN = re.compile(r"^spec:.+$|^question:Q\d+$")
HEADING_PATTERN = re.compile(r"^#{1,6}\s")
SEPARATOR_CELL_PATTERN = re.compile(r"^:?-+:?$")


class IntegrationInvariantError(Exception):
    pass


def _heading_index(lines: list[str]) -> int | None:
    for i, line in enumerate(lines):
        if line.strip() == HEADING:
            return i
    return None


def has_integration_invariants_section(md_text: str) -> bool:
    return _heading_index(md_text.splitlines()) is not None


def _extract_section_lines(md_text: str) -> list[str]:
    lines = md_text.splitlines()
    index = _heading_index(lines)
    if index is None:
        return []
    section: list[str] = []
    for line in lines[index + 1 :]:
        if HEADING_PATTERN.match(line.strip()):
            break
        section.append(line)
    return section


def _split_row(line: str) -> list[str]:
    stripped = line.strip()
    if stripped.startswith("|"):
        stripped = stripped[1:]
    if stripped.endswith("|"):
        stripped = stripped[:-1]
    return [cell.strip() for cell in stripped.split("|")]


def parse_integration_invariants(md_text: str) -> list[dict]:
    section = _extract_section_lines(md_text)
    table_lines = [line for line in section if line.strip().startswith("|")]
    if not table_lines:
        return []

    header_cells = _split_row(table_lines[0])
    if header_cells != EXPECTED_COLUMNS:
        raise IntegrationInvariantError(
            f"malformed_invariant_table: expected columns {EXPECTED_COLUMNS}, "
            f"got {header_cells}"
        )

    separator_cells = _split_row(table_lines[1]) if len(table_lines) > 1 else []
    if len(separator_cells) != len(EXPECTED_COLUMNS) or not all(
        SEPARATOR_CELL_PATTERN.match(cell) for cell in separator_cells
    ):
        raise IntegrationInvariantError(
            "malformed_invariant_table: expected a separator row after the header, "
            f"got {separator_cells}"
        )

    data_lines = table_lines[2:]
    rows: list[dict] = []
    for line in data_lines:
        cells = _split_row(line)
        if len(cells) != 4:
            row_id = cells[0] if cells else "<unknown>"
            raise IntegrationInvariantError(
                f"malformed_invariant_row: row {row_id} has {len(cells)} cells, expected 4"
            )
        row_id, invariant, covers, source = cells
        if not SOURCE_PATTERN.match(source):
            raise IntegrationInvariantError(
                f"malformed_invariant_source: row {row_id} has invalid source {source!r}"
            )
        rows.append(
            {
                "id": row_id,
                "invariant": invariant,
                "covers": [c.strip() for c in covers.split(",") if c.strip()],
                "source": source,
            }
        )
    return rows


def _task_ancestors(task_id: str, tasks: dict, memo: dict) -> set:
    if task_id in memo:
        return memo[task_id]
    result: set = set()
    stack = list(tasks.get(task_id, {}).get("depends_on", []))
    while stack:
        dep = stack.pop()
        if dep in result:
            continue
        result.add(dep)
        stack.extend(tasks.get(dep, {}).get("depends_on", []))
    memo[task_id] = result
    return result


def _group_is_ancestor(a_tasks: tuple, b_tasks: tuple, ancestors: dict) -> bool:
    if not a_tasks or not b_tasks:
        return False
    return all(a in ancestors[b] for a in a_tasks for b in b_tasks)


def _is_pytest_command(test_command: str) -> bool:
    return "pytest" in test_command


def unknown_covered_tasks(invariants: list[dict], tasks: dict) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for inv in invariants:
        for task_id in inv["covers"]:
            if task_id not in tasks:
                pairs.append((inv["id"], task_id))
    return pairs


def derive_integration_lanes(
    invariants: list[dict], tasks: dict, test_command: str
) -> list[dict]:
    if not invariants:
        return []

    groups: dict[tuple, list[str]] = {}
    for inv in invariants:
        key = tuple(sorted(set(inv["covers"])))
        # The id leads the AC text: the skeleton names the test after it.
        groups.setdefault(key, []).append(f"{inv['id']}: {inv['invariant']}")

    memo: dict = {}
    ancestors: dict = {}
    for key in groups:
        for task_id in key:
            if task_id not in ancestors:
                ancestors[task_id] = _task_ancestors(task_id, tasks, memo)

    keys = list(groups.keys())
    in_degree = {k: 0 for k in keys}
    successors: dict = {k: [] for k in keys}
    for a in keys:
        for b in keys:
            if a == b:
                continue
            if _group_is_ancestor(a, b, ancestors) and not _group_is_ancestor(
                b, a, ancestors
            ):
                successors[a].append(b)
                in_degree[b] += 1

    ordered: list[tuple] = []
    remaining = set(keys)
    while remaining:
        ready = sorted(k for k in remaining if in_degree[k] == 0)
        if not ready:
            ready = sorted(remaining)
        chosen = ready[0]
        ordered.append(chosen)
        remaining.remove(chosen)
        for succ in successors[chosen]:
            in_degree[succ] -= 1

    is_pytest = _is_pytest_command(test_command)
    lanes = []
    for n, key in enumerate(ordered, start=1):
        if is_pytest:
            files = [f"tests/integration/test_int_{n}.py"]
        else:
            files = [f"src/integration/int-{n}.test.ts"]
        covered = ", ".join(key)
        lanes.append(
            {
                "id": f"task-INT-{n}",
                "kind": "integration",
                "expect_tests_pass": True,
                "depends_on": list(key),
                "acceptance_criteria": list(groups[key]),
                "files": files,
                "title": f"Integration invariants covering {covered}",
                "red_note": (
                    f"Verify integration invariants covering {covered}: "
                    + "; ".join(groups[key])
                ),
            }
        )
    return lanes
