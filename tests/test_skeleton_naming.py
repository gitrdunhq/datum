"""caliper BUG Q (eedom wf_148432f2-fd0): `datum skeleton` named RED test
classes `TestTask_001_AC1`; pep8-naming (ruff N801) rejects the underscores,
so every skeleton-derived test failed lint in a repo with ruff's N rules on
(27 of the 29 Validate lint errors). Class names are CapWords."""

from __future__ import annotations

import re

from datum.skeleton_creator import build_skeleton, make_struct_name


def test_struct_name_is_capwords_without_underscores():
    assert make_struct_name("task-001", "AC1") == "Task001AC1"
    assert make_struct_name("task-012", "AC10") == "Task012AC10"
    assert "_" not in make_struct_name("task-1", "AC6")


def test_python_skeleton_class_passes_pep8_naming():
    skeleton = build_skeleton(
        task_id="task-005",
        ac_id="AC3",
        ac_text="The CLI prints JSON on exit 1",
        property_id="PROP-003",
        predicate_short="prints JSON on exit 1",
        task_files=["tests/test_cli.py", "datum/cli.py"],
        language="python",
    )
    match = re.search(r"^class (\w+):", skeleton["content"], re.MULTILINE)
    assert match, skeleton["content"]
    assert match.group(1) == "TestTask005AC3"
    assert re.fullmatch(r"[A-Z][A-Za-z0-9]*", match.group(1))


def test_swift_skeleton_type_is_capwords():
    skeleton = build_skeleton(
        task_id="task-002",
        ac_id="AC1",
        ac_text="Board renders fog",
        property_id="PROP-001",
        predicate_short="renders fog",
        task_files=["Tests/BoardTests.swift", "Sources/Board.swift"],
        language="swift",
    )
    assert "Task002AC1" in skeleton["content"]
    assert "Task_002_AC1" not in skeleton["content"]
