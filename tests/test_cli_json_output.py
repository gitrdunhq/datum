"""CLI commands whose stdout the workflow batches parse as JSON must print
plain bytes, never through the rich Console.

Review finding: `datum plan-issues` printed via `console.print(json.dumps(...))`.
When stdout is not a TTY (always, inside a batch), rich soft-wraps at 80
columns and inserts literal newlines inside long JSON string values — the
no-remote refusal `{"skipped": "github_repo_unresolved", "reason": <190 chars>}`
came out as invalid JSON. rich also treats `[...]` as markup. JSON goes
through typer.echo.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app

ROOT = Path(__file__).resolve().parents[1]


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def test_no_json_is_printed_through_the_rich_console():
    src = (ROOT / "datum" / "cli.py").read_text()
    offenders = [
        f"datum/cli.py:{i}"
        for i, line in enumerate(src.splitlines(), 1)
        if re.search(r"console(_err)?\.print\(\s*json\.dumps\(", line)
    ]
    assert (
        not offenders
    ), f"JSON printed through rich (wraps at 80 cols off-TTY): {offenders}"


def test_plan_issues_no_remote_refusal_is_parseable_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    import datum.github_issues as gi

    monkeypatch.setattr(gi, "REPO", None)
    lane_plan = tmp_path / "lane-plan.json"
    lane_plan.write_text(
        json.dumps({"lanes": {}, "topological_order": [], "total_lanes": 0})
    )

    res = CliRunner().invoke(
        app, ["plan-issues", "--lane-plan", str(lane_plan), "--title", "t"]
    )

    assert res.exit_code == 0, res.output
    payload = json.loads(res.output)  # must not be soft-wrapped
    assert payload["skipped"] == "github_repo_unresolved"
    assert "\n" not in payload["reason"]


def test_worktrees_setup_missing_epic_branch_is_json_on_stdout_exit_1(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(["init", "-q", "-b", "main"], repo)
    _git(
        [
            "-c",
            "user.email=t@t",
            "-c",
            "user.name=t",
            "commit",
            "-q",
            "--allow-empty",
            "-m",
            "base",
        ],
        repo,
    )
    monkeypatch.chdir(repo)

    res = CliRunner().invoke(
        app,
        [
            "worktrees",
            "setup",
            "--run-id",
            "r1",
            "--epic-branch",
            "does-not-exist",
            "--lane-ids",
            "lane-a",
        ],
    )

    assert res.exit_code == 1
    payload = json.loads(res.output.strip().splitlines()[-1])
    assert "does-not-exist" in payload["error"]
