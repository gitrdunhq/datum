"""
RED tests for 'datum tdd-args' CLI command.

AC1: 'datum tdd-args --feature "BETA / GA"' prints valid JSON with
     epicBranch, runId, lanePlanPath, testCommand, language
AC2: epicBranch is sanitized to 'feat/beta-ga'
AC3: 'datum tdd-args' with no --feature flag exits with error message

The command does not yet exist — all tests must FAIL (AttributeError or
non-zero exit) until the GREEN agent implements it.
"""

import json

import pytest
from typer.testing import CliRunner

from datum.cli import app


class TestTask_002_AC1:
    def test_ac1_tdd_args_outputs_valid_json_with_required_keys(self):
        """
        AC1: 'datum tdd-args --feature "BETA / GA"' prints valid JSON with
        epicBranch, runId, lanePlanPath, testCommand, language.
        """
        runner = CliRunner()
        result = runner.invoke(app, ["tdd-args", "--feature", "BETA / GA"])

        # Command must succeed
        assert (
            result.exit_code == 0
        ), f"Expected exit code 0, got {result.exit_code}. Output:\n{result.output}"

        # Output must be parseable JSON
        try:
            data = json.loads(result.output)
        except json.JSONDecodeError as exc:
            pytest.fail(
                f"Output is not valid JSON: {exc}\nOutput was:\n{result.output}"
            )

        # All required keys must be present
        required_keys = {
            "epicBranch",
            "runId",
            "lanePlanPath",
            "testCommand",
            "language",
        }
        missing = required_keys - set(data.keys())
        assert not missing, f"Missing required keys in JSON output: {missing}"

        # Values must be non-empty strings
        for key in required_keys:
            assert (
                isinstance(data[key], str) and data[key]
            ), f"Key '{key}' must be a non-empty string, got: {data[key]!r}"


class TestTask_002_AC2:
    def test_ac2_epic_branch_is_sanitized_from_feature_name(self):
        """
        AC2: 'datum tdd-args --feature "BETA / GA"' produces epicBranch 'feat/beta-ga'.
        """
        runner = CliRunner()
        result = runner.invoke(app, ["tdd-args", "--feature", "BETA / GA"])

        assert (
            result.exit_code == 0
        ), f"Expected exit code 0, got {result.exit_code}. Output:\n{result.output}"

        data = json.loads(result.output)
        assert (
            data["epicBranch"] == "feat/beta-ga"
        ), f"Expected epicBranch 'feat/beta-ga', got {data['epicBranch']!r}"

    def test_ac2_sanitization_lowercases_and_replaces_spaces(self):
        """
        AC2 (extra): spaces become hyphens, uppercase becomes lowercase in branch name.
        """
        runner = CliRunner()
        result = runner.invoke(app, ["tdd-args", "--feature", "Hello World"])

        assert (
            result.exit_code == 0
        ), f"Expected exit code 0, got {result.exit_code}. Output:\n{result.output}"

        data = json.loads(result.output)
        # Must start with feat/ and be lowercase-hyphenated
        assert data["epicBranch"].startswith(
            "feat/"
        ), f"epicBranch must start with 'feat/', got: {data['epicBranch']!r}"
        branch_suffix = data["epicBranch"][len("feat/") :]
        assert (
            branch_suffix == branch_suffix.lower()
        ), f"Branch suffix must be lowercase, got: {branch_suffix!r}"


class TestTask_002_AC3:
    def test_ac3_ac3_datum_tddargs_with_no_feature(self):
        """
        PROP-003: AC3: 'datum tdd-args' with no --feature flag exits with error message.
        """
        runner = CliRunner()
        result = runner.invoke(app, ["tdd-args"])

        # Must exit with a non-zero code
        assert (
            result.exit_code != 0
        ), f"Expected non-zero exit code when --feature is missing, got {result.exit_code}"

        # Must produce an error message (on stdout or stderr)
        combined_output = (result.output or "") + (
            result.stderr if hasattr(result, "stderr") else ""
        )
        assert (
            combined_output.strip()
        ), "Expected an error message when --feature is omitted, but output was empty"

    def test_ac3_error_message_mentions_feature(self):
        """
        AC3 (extra): the error output should mention 'feature' to guide the user.
        """
        runner = CliRunner()
        result = runner.invoke(app, ["tdd-args"])

        assert (
            result.exit_code != 0
        ), f"Expected non-zero exit code when --feature is missing, got {result.exit_code}"

        combined = result.output or ""
        assert (
            "feature" in combined.lower()
            or "missing" in combined.lower()
            or "required" in combined.lower()
        ), f"Error output should mention 'feature', 'missing', or 'required'. Got:\n{combined}"
