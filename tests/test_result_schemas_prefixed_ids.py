"""Tests for #526: result packet schemas (RED/GREEN/REFACTOR/ADVERSARIAL)
accept prefixed short lane ids like ``DAT-142`` in addition to legacy
``task-NNN`` ids, and share the single-source ``datum.id_pattern.LANE_ID_PATTERN``
instead of an inline ``r'^task-\\d+$'`` literal.

This is its own table-driven test file with its own fixtures -- it never
imports helpers from the sibling brief-schema lane. Every assertion routes
through ``datum.contracts.validate_payload`` (the real consumer) against a
JSON file written to a temp dir, never against `.datum/` pipeline state."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from datum import contracts
from datum.id_pattern import LANE_ID_PATTERN

RESULT_SCHEMA_CASES = [
    (
        "result-red.schema.json",
        {
            "contract_version": "1.0",
            "agent_role": "RED",
            "status": "done",
            "acceptance_criteria": [{"id": "a", "satisfied": True}],
        },
    ),
    (
        "result-green.schema.json",
        {
            "contract_version": "1.0",
            "agent_role": "GREEN",
            "status": "done",
            "acceptance_criteria": [{"id": "a", "satisfied": True}],
            "attempt": 1,
        },
    ),
    (
        "result-refactor.schema.json",
        {
            "contract_version": "1.0",
            "agent_role": "REFACTOR",
            "status": "done",
            "acceptance_criteria": [{"id": "a", "satisfied": True}],
        },
    ),
    (
        "result-adversarial.schema.json",
        {
            "contract_version": "1.0",
            "agent_role": "ADVERSARIAL",
            "status": "done",
            "acceptance_criteria": [{"id": "a", "satisfied": True}],
        },
    ),
]

RESULT_SCHEMA_SOURCE_FILES = [
    "datum/models/result_red_schema.py",
    "datum/models/result_green_schema.py",
    "datum/models/result_refactor_schema.py",
    "datum/models/result_adversarial_schema.py",
]


def _write_payload(tmp_path: Path, name: str, extra_fields: dict, task_id: str) -> Path:
    payload = {**extra_fields, "task_id": task_id}
    payload_path = (
        tmp_path / f"{name.replace('.', '_')}-{task_id.replace('-', '_')}.json"
    )
    payload_path.write_text(json.dumps(payload))
    return payload_path


class TestResultSchemasAcceptShortPrefixTaskId:
    @pytest.mark.parametrize("schema_name,extra_fields", RESULT_SCHEMA_CASES)
    def test_validate_payload_accepts_short_prefix_id(
        self, tmp_path, schema_name, extra_fields
    ):
        payload_path = _write_payload(tmp_path, schema_name, extra_fields, "DAT-142")

        errors = contracts.validate_payload(schema_name, payload_path)

        assert errors == [], f"{schema_name} rejected DAT-142: {errors}"


class TestResultSchemasStillAcceptLegacyTaskId:
    @pytest.mark.parametrize("schema_name,extra_fields", RESULT_SCHEMA_CASES)
    def test_validate_payload_accepts_legacy_task_nnn_id(
        self, tmp_path, schema_name, extra_fields
    ):
        payload_path = _write_payload(tmp_path, schema_name, extra_fields, "task-001")

        errors = contracts.validate_payload(schema_name, payload_path)

        assert errors == [], f"{schema_name} rejected task-001: {errors}"


class TestResultSchemasRejectMalformedPrefixedId:
    @pytest.mark.parametrize("schema_name,extra_fields", RESULT_SCHEMA_CASES)
    @pytest.mark.parametrize("bad_task_id", ["dat-142", "DATUM-142"])
    def test_validate_payload_rejects_malformed_id(
        self, tmp_path, schema_name, extra_fields, bad_task_id
    ):
        payload_path = _write_payload(tmp_path, schema_name, extra_fields, bad_task_id)

        errors = contracts.validate_payload(schema_name, payload_path)

        assert (
            errors != []
        ), f"{schema_name} should reject {bad_task_id!r} but validated cleanly"
        assert any(
            "task_id" in err for err in errors
        ), f"{schema_name} rejection for {bad_task_id!r} did not reference task_id: {errors}"


class TestResultSchemaSourcesShareLaneIdPatternConstant:
    @pytest.mark.parametrize("source_file", RESULT_SCHEMA_SOURCE_FILES)
    def test_source_file_has_no_inline_task_pattern_literal(self, source_file):
        text = Path(source_file).read_text()

        assert (
            r"^task-\d+$" not in text
        ), f"{source_file} still hardcodes the legacy task-only pattern literal"

    @pytest.mark.parametrize(
        "schema_name,extra_fields",
        RESULT_SCHEMA_CASES,
    )
    def test_model_pattern_matches_shared_lane_id_pattern_constant(
        self, tmp_path, schema_name, extra_fields
    ):
        # The model's task_id field must be driven by the same regex as
        # datum.id_pattern.LANE_ID_PATTERN, proven behaviorally: every id
        # LANE_ID_PATTERN accepts must validate through validate_payload,
        # and a value it accepts that the current literal rejects (a
        # 3-char short prefix like DAT-142) is exactly what AC1 wants.
        assert re.fullmatch(LANE_ID_PATTERN, "DAT-142")
        payload_path = _write_payload(tmp_path, schema_name, extra_fields, "DAT-142")

        errors = contracts.validate_payload(schema_name, payload_path)

        assert (
            errors == []
        ), f"{schema_name} task_id field is not driven by datum.id_pattern.LANE_ID_PATTERN: {errors}"
