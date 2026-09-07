# Skeleton: task-1 AC6 — PROP-006
# RED agent: fill in the assertion body. Do not rename this function or move this file.
# Traceability: AC6 → test_ac6_when-agent-returns-an-empty-json-array-runruffcheck-returns → tests/test_ruff_precheck.py

import pytest


class TestTask_1_AC6:
    @pytest.mark.xfail(
        reason="BUG: AC6 targets TypeScript runRuffCheck (skills/src/datum-tdd-act-lane.ts, task-1); not reachable from pytest — belongs in skills/src/*.test.ts"
    )
    def test_ac6_when_agent_returns_an_empty_json_array_runruffcheck_returns(self):
        """
        PROP-006: When agent() returns an empty JSON array [], runRuffCheck returns { passed: true
        """
        # Arrange

        # Act

        # Assert — prove PROP-006
        raise AssertionError("RED agent: implement this assertion")
