"""Executor, preflight and edge-case schemas accept prefixed task ids (task-005).

ExecutorResultPerAcVerdict, PreflightResult and CandidateEdgeCases currently
pin task_id to the literal pattern ``^task-\\d+$``. This lane widens all
three to accept short-prefix ids like ``DAT-142`` while continuing to accept
plain ``task-001`` ids and rejecting malformed variants such as lowercase
prefixes. It also owns the repo-wide sweep assertion: no file under
datum/models/ may contain the literal substring ``task-\\d`` once every
widening lane (task-001..task-004) plus this lane has landed.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from datum.models.candidate_edge_cases_schema import CandidateEdgeCases
from datum.models.executor_result_schema import Commit, ExecutorResultPerAcVerdict
from datum.models.preflight_result_schema import PreflightResult


def _executor_payload(task_id: str) -> dict:
    return {
        "contract_version": "1.0",
        "agent_role": "RED",
        "task_id": task_id,
        "status": "done",
        "acceptance_criteria": [{"id": "AC1", "satisfied": True}],
    }


def _preflight_payload(task_id: str) -> dict:
    return {
        "task_id": task_id,
        "language": "python",
        "framework": "pytest",
        "outputs": [
            {
                "ac_id": "AC1",
                "path": "tests/test_x.py",
                "kind": "pytest",
                "purpose": "test purpose",
                "property_id": "PROP-001",
            }
        ],
    }


def _candidate_payload(task_id: str) -> dict:
    return {
        "contract_version": "1.0",
        "agent_role": "ADVERSARIAL",
        "task_id": task_id,
        "candidates": [
            {
                "id": "EC-1",
                "property_id": "PROP-001",
                "description": "edge case",
                "expected_violation": "raises error",
                "verdict": "gap",
            }
        ],
    }


MODEL_CASES = [
    ("ExecutorResultPerAcVerdict", ExecutorResultPerAcVerdict, _executor_payload),
    ("PreflightResult", PreflightResult, _preflight_payload),
    ("CandidateEdgeCases", CandidateEdgeCases, _candidate_payload),
]


class TestTask005AC1:
    """AC1: ExecutorResult, PreflightResult and CandidateEdgeCases payloads
    with task_id='DAT-142' validate."""

    def test_executor_result_accepts_dat_142(self):
        validated = ExecutorResultPerAcVerdict.model_validate(
            _executor_payload("DAT-142")
        )
        assert validated.task_id == "DAT-142"

    def test_preflight_result_accepts_dat_142(self):
        validated = PreflightResult.model_validate(_preflight_payload("DAT-142"))
        assert validated.task_id == "DAT-142"

    def test_candidate_edge_cases_accepts_dat_142(self):
        validated = CandidateEdgeCases.model_validate(_candidate_payload("DAT-142"))
        assert validated.task_id == "DAT-142"


class TestTask005AC2:
    """AC2: the same three payloads with task_id='task-001' still validate,
    and each raises pydantic.ValidationError for 'dat-142'."""

    def test_executor_result_still_accepts_task_001(self):
        validated = ExecutorResultPerAcVerdict.model_validate(
            _executor_payload("task-001")
        )
        assert validated.task_id == "task-001"

    def test_preflight_result_still_accepts_task_001(self):
        validated = PreflightResult.model_validate(_preflight_payload("task-001"))
        assert validated.task_id == "task-001"

    def test_candidate_edge_cases_still_accepts_task_001(self):
        validated = CandidateEdgeCases.model_validate(_candidate_payload("task-001"))
        assert validated.task_id == "task-001"

    def test_executor_result_rejects_lowercase_dat_142(self):
        with pytest.raises(ValidationError):
            ExecutorResultPerAcVerdict.model_validate(_executor_payload("dat-142"))

    def test_preflight_result_rejects_lowercase_dat_142(self):
        with pytest.raises(ValidationError):
            PreflightResult.model_validate(_preflight_payload("dat-142"))

    def test_candidate_edge_cases_rejects_lowercase_dat_142(self):
        with pytest.raises(ValidationError):
            CandidateEdgeCases.model_validate(_candidate_payload("dat-142"))


class TestTask005AC3:
    """AC3: the commit-message field on executor_result_schema no longer
    hardcodes only 'feat(task-001)' as its example, and the field itself
    imposes no task-\\d-only constraint — a prefixed conventional-commit
    subject must validate, and a subject with no type prefix must still
    raise ValidationError."""

    def test_commit_message_accepts_prefixed_conventional_commit(self):
        commit = Commit.model_validate(
            {
                "type": "implementation",
                "files": ["datum/models/executor_result_schema.py"],
                "patch": "diff --git a/x b/x",
                "message": "feat(DAT-142): widen task id pattern",
            }
        )
        assert commit.message == "feat(DAT-142): widen task id pattern"

    def test_commit_message_rejects_subject_without_conventional_type(self):
        with pytest.raises(ValidationError):
            Commit.model_validate(
                {
                    "type": "implementation",
                    "files": ["datum/models/executor_result_schema.py"],
                    "patch": "diff --git a/x b/x",
                    "message": "widen schemas to accept prefixed ids",
                }
            )


class TestTask005AC4:
    """AC4: a repo-wide test asserts that no file under datum/models/
    contains the literal substring 'task-\\d' — the last three offenders
    (executor_result_schema.py, preflight_result_schema.py,
    candidate_edge_cases_schema.py) are removed by this task."""

    def test_no_file_under_datum_models_contains_inline_task_id_literal(self):
        repo_root = Path(__file__).resolve().parent.parent
        models_dir = repo_root / "datum" / "models"

        offenders = []
        for path in sorted(models_dir.glob("*.py")):
            text = path.read_text()
            if r"task-\d" in text:
                offenders.append(str(path.relative_to(repo_root)))

        assert offenders == [], (
            "inline 'task-\\\\d' regex literal still present in: " f"{offenders}"
        )
