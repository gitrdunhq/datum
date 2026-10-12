"""The properties gate's traceability check must accept every lane id shape.

Since the monotonic-task-ids epic, fresh epics get repo-wide ids such as
DAT-10. The gate searched PROPERTIES.md for the literal text "task-", so a
traceability table that cited only DAT-n ids failed with "missing
traceability table" (run wf_a3714853-a15). The check now uses the shared
lane id pattern from datum.id_pattern.
"""

from __future__ import annotations

from datum.gate import has_task_references

TABLE_HEAD = "## Traceability Table\n\n| Property ID | Category | Predicate | Task IDs |\n|---|---|---|---|\n"


def test_prefixed_ids_count_as_task_references():
    # Catches: a DAT-n only traceability table failing the gate.
    content = TABLE_HEAD + "| SAFETY-001 | SAFETY | x | DAT-1, DAT-16 |\n"
    assert has_task_references(content) is True


def test_legacy_task_ids_still_count():
    # Catches: the widening dropping the old task-NNN and task-INT-N shapes.
    assert has_task_references(TABLE_HEAD + "| S-1 | SAFETY | x | task-001 |\n") is True
    assert has_task_references(TABLE_HEAD + "| S-1 | SAFETY | x | task-INT-2 |\n") is True


def test_property_ids_alone_are_not_task_references():
    # Catches: property ids such as SAFETY-001 (six letters, matches the
    # six-letter prefix arm of the lane pattern) being read as lane ids, which
    # would pass a table whose Task IDs column is empty.
    content = TABLE_HEAD + "| SAFETY-001 | SAFETY | x |  |\n| INVARIANT-002 | INVARIANT | y |  |\n"
    assert has_task_references(content) is False


def test_no_table_and_no_ids_fails():
    # Catches: an empty document passing.
    assert has_task_references("# PROPERTIES\n\nNothing here.\n") is False


def test_a_data_cell_starting_with_task_is_not_a_header():
    # Catches: a row cell such as "Task IDs are unique" being taken for the
    # Task IDs column header, which hides the real task-001 reference.
    content = (
        "## Integration Invariants\n\n| ID | Invariant | Covers |\n|---|---|---|\n"
        "| INV-001 | Task IDs are unique | task-001 |\n"
    )
    assert has_task_references(content) is True
