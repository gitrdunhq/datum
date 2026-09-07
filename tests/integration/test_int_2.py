"""INT-09: the epic's own lane-plan makes the final task cut with the sole
rule "no single-layer task".

This is an INTEGRATION lane (kind="integration", expect_tests_pass=True).
The plan file docs/epics/datum/integration-lanes-2/lane-plan.json is the
already-merged artifact under test: task-001, task-002 and task-003 (and
their file lists) are fixed facts, not code to be written by GREEN. These
tests are expected to PASS on first run — a failing test here is a real
finding about the plan, not a RED-stage placeholder to be turned green
later.

INT-09 text (verbatim from the lane spec):
    Plan makes the final task cut with the sole rule "no single-layer
    task"; task-001 crosses digest+export (Python producer layer only per
    its own scope) while task-002 crosses runner+types+prompt (R1, R2,
    R4.2) and task-003 crosses classifier+destination-map+label-map (R3)
    — each of task-002 and task-003 individually spans multiple layers,
    and R6 is verified by this epic's own Act run rather than as a
    separate task.
"""

import json
import re
from pathlib import Path

import pytest

_PLAN_PATH = (
    Path(__file__).resolve().parents[2]
    / "docs"
    / "epics"
    / "datum"
    / "integration-lanes-2"
    / "lane-plan.json"
)

# Keyword -> layer tag. A file may match more than one keyword; the layer
# tags actually present per task are what INT-09 calls "layers".
_LAYER_KEYWORDS = {
    "lane_plan_digest": "digest",
    "lane_spec_export": "export",
    "datum-tdd-act-lane": "lane-runner",
    "types.ts": "types",
    "prompts.ts": "prompt",
    "red.md": "prompt",
    "triage-classify": "classifier",
    "datum-tdd-act-triage": "triage-label-map",
    "verdicts": "verdicts",
}


def _load_plan() -> dict:
    return json.loads(_PLAN_PATH.read_text())


def _layer_tags(files: list) -> set:
    tags = set()
    for f in files:
        for kw, tag in _LAYER_KEYWORDS.items():
            if kw in f:
                tags.add(tag)
    return tags


def test_int09_task_001_crosses_digest_and_export_within_python_producer_scope():
    plan = _load_plan()
    task_001 = plan["lanes"]["task-001"]

    assert task_001["files"] == [
        "datum/lane_plan_digest.py",
        "tests/test_lane_plan_digest_expect_tests_pass.py",
        "tests/test_lane_spec_export_integration_fields.py",
    ]

    tags = _layer_tags(task_001["files"])
    assert tags == {"digest", "export"}

    # "Python producer layer only per its own scope": no TypeScript/skills
    # file appears in task-001's file list.
    assert not any(f.startswith("skills/") for f in task_001["files"])
    assert task_001["kind"] == "behavioral"


def test_int09_task_002_crosses_runner_types_and_prompt_layers():
    plan = _load_plan()
    task_002 = plan["lanes"]["task-002"]

    assert task_002["files"] == [
        "skills/src/datum-tdd-act-lane.ts",
        "skills/src/shared/types.ts",
        "skills/src/shared/prompts.ts",
        "skills/src/prompts/red.md",
        "skills/src/datum-tdd-act-lane.integration.test.ts",
    ]

    tags = _layer_tags(task_002["files"])
    assert tags == {"lane-runner", "types", "prompt"}
    assert len(tags) == 3

    # task-002 individually spans multiple layers (not single-layer).
    assert len(tags) > 1


def test_int09_task_003_crosses_classifier_and_label_map_layers():
    plan = _load_plan()
    task_003 = plan["lanes"]["task-003"]

    assert task_003["files"] == [
        "skills/src/shared/triage-classify.ts",
        "skills/src/datum-tdd-act-triage.ts",
        "skills/src/shared/triage-classify-code-defect.test.ts",
        "skills/src/shared/triage-classify.test.ts",
        "skills/src/shared/verdicts.property.test.ts",
    ]

    tags = _layer_tags(task_003["files"])
    assert tags == {"classifier", "triage-label-map", "verdicts"}
    assert len(tags) == 3

    # task-003 individually spans multiple layers (not single-layer).
    assert len(tags) > 1


def test_int09_no_single_layer_task_among_task_001_002_003():
    plan = _load_plan()

    for task_id in ("task-001", "task-002", "task-003"):
        lane = plan["lanes"][task_id]
        tags = _layer_tags(lane["files"])
        assert len(tags) >= 2, (
            f"{task_id} is single-layer under INT-09's tag scheme "
            f"(tags={tags}, files={lane['files']})"
        )


def test_int09_r6_is_not_a_dedicated_task():
    plan = _load_plan()

    # R6 (the real-merged-branch case) is explicitly deferred to this
    # epic's own Act run rather than being carved out as its own lane —
    # no lane title names R6 as its scope.
    for lane_id, lane in plan["lanes"].items():
        assert "R6" not in lane["title"], (
            f"{lane_id} claims R6 as a dedicated task, contradicting "
            "INT-09's statement that R6 is verified by the epic's own "
            "Act run"
        )

    # R6 is nonetheless a real, named requirement elsewhere in the plan
    # (task-INT-3's red_note), so this isn't just an absent string.
    r6_mentions = [
        lane_id
        for lane_id, lane in plan["lanes"].items()
        if re.search(r"\bR6\b", lane.get("red_note", ""))
        or re.search(r"\bR6\b", "; ".join(lane.get("acceptance_criteria", [])))
    ]
    assert set(r6_mentions) == {"task-INT-2", "task-INT-3"}
