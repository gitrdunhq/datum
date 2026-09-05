# Skeleton: task-002 AC3 — PROP-003
# RED agent: fill in the assertion body. Do not rename this function or move this file.
# Traceability: AC3 → test_ac3_ac3_datum_tddargs_with_no_feature → tests/test_tdd_cli_commands.py

import json
import subprocess

import pytest
from typer.testing import CliRunner

from datum.cli import app


class TestTask_002_AC3:
    def test_ac3_ac3_datum_tddargs_with_no_feature(self):
        """
        PROP-003: AC3: 'datum tdd-args' with no --feature flag defaults to the
        current git branch name as the epic branch base.
        """
        # Arrange
        runner = CliRunner()

        # Act
        result = runner.invoke(app, ["tdd-args"])

        # Assert — prove PROP-003
        # Must exit successfully when inside a git repo
        assert (
            result.exit_code == 0
        ), f"Expected exit code 0 inside git repo, got {result.exit_code}. Output:\n{result.output}"

        # Output must be parseable JSON
        try:
            data = json.loads(result.output)
        except json.JSONDecodeError as exc:
            pytest.fail(
                f"Output is not valid JSON: {exc}\nOutput was:\n{result.output}"
            )

        # epicBranch must be derived from current branch (dev)
        assert "epicBranch" in data, f"Missing epicBranch in JSON output: {data}"
        assert data["epicBranch"].startswith(
            "feat/"
        ), f"epicBranch must start with 'feat/', got: {data['epicBranch']}"

    def test_ac3_fails_outside_git_repo(self, tmp_path):
        """
        AC3 (extra): when no --feature is provided and we are NOT in a git repo,
        the command must exit with a clear error message.
        """
        # Arrange: run the command from a directory that is NOT a git repo
        runner = CliRunner()

        # Act
        result = runner.invoke(app, ["tdd-args", "--repo", str(tmp_path)])

        # Assert
        assert (
            result.exit_code != 0
        ), f"Expected non-zero exit when no --feature and not in git repo, got {result.exit_code}"

        # Must produce an error message
        assert result.output.strip(), "Expected an error message, but output was empty"

        # Error should mention something about git branch or inability to determine
        output_lower = result.output.lower()
        assert (
            "git" in output_lower
            or "branch" in output_lower
            or "cannot" in output_lower
            or "unable" in output_lower
        ), f"Error message should mention git, branch, or failure. Got:\n{result.output}"
