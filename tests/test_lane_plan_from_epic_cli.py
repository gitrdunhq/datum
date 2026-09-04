"""Tests for `datum lane-plan-from-epic <epic_number>` CLI command.

Reverse of `plan-issues` (lane-plan.json -> GitHub sub-issues): converts an
already-decomposed GitHub epic issue's sub-issues (each carrying a
datum:metadata comment block) back into a local lane-plan.json. Wraps the
existing, previously-unwired `datum.github_issues.build_lane_plan_from_epic`.

Acceptance criteria:
1. Writes the resulting lane-plan dict to --output (default .datum/lane-plan.json)
   and prints it to stdout.
2. A GitHub/gh failure (list_sub_issues raising) is reported clearly and exits
   non-zero, without writing a partial/corrupt output file.
3. `--output` lets the caller choose a different destination path.
"""

from __future__ import annotations

import json

from typer.testing import CliRunner

from datum.cli import app

FAKE_SUB_ISSUES = [
    {
        "number": 101,
        "title": "Lane A",
        "state": "OPEN",
        "metadata": {
            "files": ["a.py"],
            "acceptance_criteria": ["does a thing"],
            "depends_on": [],
            "stage": "queued",
        },
    },
    {
        "number": 102,
        "title": "Lane B",
        "state": "OPEN",
        "metadata": {
            "files": ["b.py"],
            "acceptance_criteria": ["does b thing"],
            "depends_on": [101],
            "stage": "queued",
        },
    },
]


def test_lane_plan_from_epic_writes_output_and_prints_json(tmp_path, monkeypatch):
    """AC1: writes lane-plan.json to --output (default path) and prints it."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    monkeypatch.setattr(
        "datum.github_issues.list_sub_issues", lambda epic_number: FAKE_SUB_ISSUES
    )

    runner = CliRunner()
    result = runner.invoke(app, ["lane-plan-from-epic", "42"])

    assert result.exit_code == 0, result.output
    output_path = tmp_path / ".datum" / "lane-plan.json"
    assert output_path.exists()

    written = json.loads(output_path.read_text())
    assert written["epic_issue"] == 42
    assert written["total_lanes"] == 2
    assert "#101" in written["lanes"]
    assert "#102" in written["lanes"]
    assert written["lanes"]["#102"]["depends_on"] == ["#101"]

    printed = json.loads(result.stdout)
    assert printed == written


def test_lane_plan_from_epic_custom_output_path(tmp_path, monkeypatch):
    """AC3: --output writes to a caller-chosen path instead of the default."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    monkeypatch.setattr(
        "datum.github_issues.list_sub_issues", lambda epic_number: FAKE_SUB_ISSUES
    )

    custom_path = tmp_path / "custom" / "plan.json"
    runner = CliRunner()
    result = runner.invoke(
        app, ["lane-plan-from-epic", "42", "--output", str(custom_path)]
    )

    assert result.exit_code == 0, result.output
    assert custom_path.exists()
    assert not (tmp_path / ".datum" / "lane-plan.json").exists()


def test_lane_plan_from_epic_reports_gh_failure_and_exits_nonzero(
    tmp_path, monkeypatch
):
    """AC2: a gh/list_sub_issues failure is reported clearly, no partial output written."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / ".datum").mkdir()

    def _raise(epic_number):
        raise RuntimeError("gh api ... failed: 404 Not Found")

    monkeypatch.setattr("datum.github_issues.list_sub_issues", _raise)

    runner = CliRunner()
    result = runner.invoke(app, ["lane-plan-from-epic", "999"])

    assert result.exit_code != 0
    assert "404" in result.output or "failed" in result.output.lower()
    assert not (tmp_path / ".datum" / "lane-plan.json").exists()
