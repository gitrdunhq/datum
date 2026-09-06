"""Parse the '## Integration Invariants' table out of PROPERTIES.md."""

from __future__ import annotations

import re

HEADING = "## Integration Invariants"
EXPECTED_COLUMNS = ["ID", "Invariant", "Covers", "Source"]
SOURCE_PATTERN = re.compile(r"^spec:.+$|^question:Q\d+$")


class IntegrationInvariantError(Exception):
    pass


def has_integration_invariants_section(md_text: str) -> bool:
    return HEADING in md_text


def _extract_section_lines(md_text: str) -> list[str]:
    lines = md_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if line.strip() == HEADING:
            start = i + 1
            break
    if start is None:
        return []
    section: list[str] = []
    for line in lines[start:]:
        if line.strip().startswith("## ") and line.strip() != HEADING:
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
                "covers": [c.strip() for c in covers.split(",")],
                "source": source,
            }
        )
    return rows
