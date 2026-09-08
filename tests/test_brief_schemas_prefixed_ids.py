"""Brief packet schemas accept prefixed task ids (task-003).

DatumRedBrief, DatumGreenBrief, DatumGreenContinuationBrief and
DatumRefactorBrief currently pin task_id to the literal pattern
``^task-\\d+$``. This lane widens all four to accept short-prefix ids
like ``DAT-142`` (via datum.id_pattern.LANE_ID_PATTERN) while continuing
to accept plain ``task-001`` ids and rejecting malformed variants such as
lowercase prefixes or missing the hyphen.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from datum.contracts import validate_payload
from datum.id_pattern import LANE_ID_PATTERN
from datum.models.brief_green_continuation_schema import DatumGreenContinuationBrief
from datum.models.brief_green_schema import DatumGreenBrief
from datum.models.brief_red_schema import DatumRedBrief
from datum.models.brief_refactor_schema import DatumRefactorBrief

RUN_ID = "epic-1-20260907-201926"


def _red_payload(task_id: str) -> dict:
    return {
        "contract_version": "1.0",
        "agent_role": "RED",
        "task_id": task_id,
        "run_id": RUN_ID,
        "spec_excerpt": "widen brief schemas to accept prefixed ids",
        "properties": [
            {"id": "PROP-001", "category": "behavior", "predicate": "does the thing"}
        ],
        "acceptance_criteria": ["prefixed ids validate"],
        "files_to_write": ["tests/test_brief_schemas_prefixed_ids.py"],
        "red_note": "n/a",
        "introduces_stubs": False,
        "stub_files": [],
        "language": "python",
        "framework": "pytest",
        "gitnexus_context": None,
        "upstream_stubs": [],
        "lane_tools_readme": "",
    }


def _green_payload(task_id: str) -> dict:
    return {
        "contract_version": "1.0",
        "agent_role": "GREEN",
        "task_id": task_id,
        "run_id": RUN_ID,
        "spec_excerpt": "widen brief schemas to accept prefixed ids",
        "properties": [{"id": "PROP-001"}],
        "acceptance_criteria": ["prefixed ids validate"],
        "files_to_write": ["datum/models/brief_green_schema.py"],
        "language": "python",
        "framework": "pytest",
        "test_signal": {
            "status": "fail",
            "assertion_failures": [],
            "compile_errors": [],
            "runtime_errors": [],
        },
        "gitnexus_context": None,
        "lane_tools_readme": "",
        "attempt": 1,
    }


def _green_continuation_payload(task_id: str) -> dict:
    return {
        "contract_version": "1.0",
        "agent_role": "GREEN",
        "turn_type": "continuation",
        "task_id": task_id,
        "turn": 2,
        "green_max_turns": 3,
        "test_signal": {"status": "fail"},
        "diff_since_last_attempt": "",
        "message": "still failing",
    }


def _refactor_payload(task_id: str) -> dict:
    return {
        "contract_version": "1.0",
        "agent_role": "REFACTOR",
        "task_id": task_id,
        "run_id": RUN_ID,
        "spec_excerpt": "widen brief schemas to accept prefixed ids",
        "properties": [{"id": "PROP-001"}],
        "acceptance_criteria": ["prefixed ids validate"],
        "files_to_write": ["datum/models/brief_refactor_schema.py"],
        "language": "python",
        "framework": "pytest",
        "implementation_files": [
            {"path": "datum/models/brief_refactor_schema.py", "content": ""}
        ],
        "test_files": [
            {"path": "tests/test_brief_schemas_prefixed_ids.py", "content": ""}
        ],
        "test_results": "",
        "gitnexus_impact": None,
        "lane_tools_readme": "",
        "brief_defects_so_far": [],
    }


BRIEF_CASES = [
    ("brief-red.schema.json", DatumRedBrief, _red_payload),
    ("brief-green.schema.json", DatumGreenBrief, _green_payload),
    (
        "brief-green-continuation.schema.json",
        DatumGreenContinuationBrief,
        _green_continuation_payload,
    ),
    ("brief-refactor.schema.json", DatumRefactorBrief, _refactor_payload),
]


@pytest.mark.parametrize("schema_name,model_cls,build_payload", BRIEF_CASES)
def test_ac1_prefixed_task_id_dat_142_validates_through_validate_payload(
    tmp_path, schema_name, model_cls, build_payload
):
    """AC1: BriefRed/Green/GreenContinuation/Refactor with task_id='DAT-142' validate."""
    payload = build_payload("DAT-142")
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(payload))

    errors = validate_payload(schema_name, payload_path)

    assert errors == [], f"{schema_name} rejected DAT-142: {errors}"
    model_cls.model_validate(payload)


@pytest.mark.parametrize("schema_name,model_cls,build_payload", BRIEF_CASES)
def test_ac2_legacy_task_001_still_validates_through_validate_payload(
    tmp_path, schema_name, model_cls, build_payload
):
    """AC2: the same four payloads with task_id='task-001' still validate."""
    payload = build_payload("task-001")
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(payload))

    errors = validate_payload(schema_name, payload_path)

    assert errors == [], f"{schema_name} rejected task-001: {errors}"
    model_cls.model_validate(payload)


@pytest.mark.parametrize("schema_name,model_cls,build_payload", BRIEF_CASES)
@pytest.mark.parametrize("bad_task_id", ["dat-142", "DAT142"])
def test_ac3_malformed_prefixed_ids_raise_validation_error(
    tmp_path, schema_name, model_cls, build_payload, bad_task_id
):
    """AC3: task_id='dat-142' (lowercase) and 'DAT142' (no hyphen) raise ValidationError."""
    payload = build_payload(bad_task_id)

    with pytest.raises(ValidationError):
        model_cls.model_validate(payload)


def test_ac4_no_inline_task_regex_literal_remains_in_edited_schema_files():
    """AC4: none of the four schema files inline r'^task-\\d+$' anymore —
    each must reference datum.id_pattern.LANE_ID_PATTERN instead."""
    repo_root = Path(__file__).resolve().parent.parent
    edited_files = [
        repo_root / "datum/models/brief_red_schema.py",
        repo_root / "datum/models/brief_green_schema.py",
        repo_root / "datum/models/brief_green_continuation_schema.py",
        repo_root / "datum/models/brief_refactor_schema.py",
    ]

    offenders = []
    for path in edited_files:
        text = path.read_text()
        if r"task-\d+" in text:
            offenders.append(str(path))
        if "LANE_ID_PATTERN" not in text:
            offenders.append(f"{path} (missing LANE_ID_PATTERN reference)")

    assert (
        offenders == []
    ), f"stale inline task id regex or missing LANE_ID_PATTERN reference: {offenders}"


def test_lane_id_pattern_accepts_dat_142_and_task_001_and_rejects_lowercase():
    """Sanity check the shared pattern the four schemas are expected to delegate to."""
    import re

    assert re.fullmatch(LANE_ID_PATTERN, "DAT-142") is not None
    assert re.fullmatch(LANE_ID_PATTERN, "task-001") is not None
    assert re.fullmatch(LANE_ID_PATTERN, "dat-142") is None
    assert re.fullmatch(LANE_ID_PATTERN, "DAT142") is None
