"""RED tests for datum.integration_invariants.

parse_integration_invariants(md_text) -> list[dict] with keys id, invariant,
covers (list[str]), source (str) — parses the '## Integration Invariants'
table out of PROPERTIES.md-shaped markdown.

has_integration_invariants_section(md_text) -> bool — distinguishes an
absent heading from a heading with an empty table.

Malformed inputs raise IntegrationInvariantError with specific message
prefixes: malformed_invariant_table:, malformed_invariant_row:,
malformed_invariant_source:.
"""

from __future__ import annotations

import pytest
from datum.integration_invariants import (
    IntegrationInvariantError,
    has_integration_invariants_section,
    parse_integration_invariants,
)

VALID_TABLE_MD = """# PROPERTIES.md

## Integration Invariants

| ID | Invariant | Covers | Source |
| --- | --- | --- | --- |
| INV-001 | Task IDs are unique | task-001, task-002 | spec:section-3 |
| INV-002 | Every question has coverage | task-003 | question:Q1 |
"""


class TestParseIntegrationInvariantsReturnsRows:
    def test_returns_list_of_dicts_with_expected_keys_and_order(self) -> None:
        rows = parse_integration_invariants(VALID_TABLE_MD)
        assert isinstance(rows, list)
        assert len(rows) == 2
        assert rows[0] == {
            "id": "INV-001",
            "invariant": "Task IDs are unique",
            "covers": ["task-001", "task-002"],
            "source": "spec:section-3",
        }
        assert rows[1]["id"] == "INV-002"
        assert rows[1]["source"] == "question:Q1"


class TestParseIntegrationInvariantsSplitsCovers:
    def test_covers_split_on_commas_and_stripped(self) -> None:
        rows = parse_integration_invariants(VALID_TABLE_MD)
        assert rows[0]["covers"] == ["task-001", "task-002"]
        assert rows[1]["covers"] == ["task-003"]


class TestParseIntegrationInvariantsMalformedTable:
    def test_wrong_column_order_raises_malformed_invariant_table(self) -> None:
        md = """## Integration Invariants

| Invariant | ID | Covers | Source |
| --- | --- | --- | --- |
| Task IDs are unique | INV-001 | task-001 | spec:section-3 |
"""
        with pytest.raises(IntegrationInvariantError) as excinfo:
            parse_integration_invariants(md)
        assert str(excinfo.value).startswith("malformed_invariant_table:")

    def test_missing_column_raises_malformed_invariant_table(self) -> None:
        md = """## Integration Invariants

| ID | Invariant | Source |
| --- | --- | --- |
| INV-001 | Task IDs are unique | spec:section-3 |
"""
        with pytest.raises(IntegrationInvariantError) as excinfo:
            parse_integration_invariants(md)
        assert str(excinfo.value).startswith("malformed_invariant_table:")


class TestParseIntegrationInvariantsMalformedRow:
    def test_row_with_wrong_cell_count_raises_malformed_invariant_row(self) -> None:
        md = """## Integration Invariants

| ID | Invariant | Covers | Source |
| --- | --- | --- | --- |
| INV-001 | Task IDs are unique | task-001 |
"""
        with pytest.raises(IntegrationInvariantError) as excinfo:
            parse_integration_invariants(md)
        msg = str(excinfo.value)
        assert msg.startswith("malformed_invariant_row:")
        assert "INV-001" in msg


class TestParseIntegrationInvariantsMalformedSource:
    def test_row_with_unrecognized_source_raises_malformed_invariant_source(
        self,
    ) -> None:
        md = """## Integration Invariants

| ID | Invariant | Covers | Source |
| --- | --- | --- | --- |
| INV-001 | Task IDs are unique | task-001 | somewhere-else |
"""
        with pytest.raises(IntegrationInvariantError) as excinfo:
            parse_integration_invariants(md)
        msg = str(excinfo.value)
        assert msg.startswith("malformed_invariant_source:")
        assert "INV-001" in msg


class TestParseIntegrationInvariantsEmptyTable:
    def test_heading_present_with_zero_rows_returns_empty_list(self) -> None:
        md = """## Integration Invariants

| ID | Invariant | Covers | Source |
| --- | --- | --- | --- |
"""
        rows = parse_integration_invariants(md)
        assert rows == []


class TestHasIntegrationInvariantsSection:
    def test_returns_false_when_heading_absent(self) -> None:
        md = "# PROPERTIES.md\n\nNo relevant section here.\n"
        assert has_integration_invariants_section(md) is False

    def test_returns_true_when_heading_present(self) -> None:
        assert has_integration_invariants_section(VALID_TABLE_MD) is True

    def test_returns_true_even_when_table_is_empty(self) -> None:
        md = """## Integration Invariants

| ID | Invariant | Covers | Source |
| --- | --- | --- | --- |
"""
        assert has_integration_invariants_section(md) is True
