"""Tests for `datum ticket-from-issue <issue_number>` CLI command.

Closes the issueNumber bootstrap gap: skills/src/datum-refine.ts accepts an
issueNumber forwarded from datum-go.ts, but until now datum-go never
actually bootstrapped TICKET.md from a GitHub issue automatically — that
input was silently ignored (deliberate, documented gap). This command
fetches the issue's title/body, runs the real `init()` bootstrap (branch +
epic dir + skills), then overwrites the placeholder TICKET.md with the
issue content and commits it.

Acceptance criteria:
1. Fetches the issue, derives a slug from its title, bootstraps the epic via
   `datum init --name <slug>`, writes TICKET.md with the issue body, commits,
   and prints the resulting epic branch / ticket path as JSON.
2. A gh/fetch_issue failure is reported clearly and exits non-zero, without
   creating a new branch or epic dir.
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from typer.testing import CliRunner

from datum.cli import app

FAKE_ISSUE = {
    "number": 42,
    "title": "Add dark mode toggle",
    "body": "## What\n\nAdd a dark mode toggle to settings.\n",
}


def _git_repo(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "t@example.com"], cwd=path, check=True
    )
    subprocess.run(["git", "config", "user.name", "T"], cwd=path, check=True)
    (path / "README.md").write_text("# fixture\n")
    subprocess.run(["git", "add", "."], cwd=path, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=path, check=True)


def _branch(path: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=path,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def test_ticket_from_issue_bootstraps_epic_and_writes_ticket(tmp_path, monkeypatch):
    """AC1: bootstraps the epic and writes the issue body into TICKET.md."""
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setattr(
        "datum.github_issues.fetch_issue", lambda issue_number: FAKE_ISSUE
    )

    runner = CliRunner()
    result = runner.invoke(app, ["ticket-from-issue", "42"])

    assert result.exit_code == 0, result.output
    branch = _branch(repo)
    assert branch != "main"

    ticket_path = repo / "docs" / "epics" / branch / "TICKET.md"
    assert ticket_path.exists()
    content = ticket_path.read_text()
    assert "Add dark mode toggle" in content
    assert "dark mode toggle to settings" in content

    log = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo, capture_output=True, text=True
    ).stdout
    assert "ticket" in log.lower()

    # stdout also carries init()'s own JSON status line before ours — take
    # the LAST complete {...} object, which is our final summary.
    candidates = re.findall(r"\{[^{}]*\}", result.stdout)
    printed = json.loads(candidates[-1])
    assert printed["issueNumber"] == 42
    assert printed["epicBranch"] == branch


def test_ticket_from_issue_reports_fetch_failure_and_exits_nonzero(
    tmp_path, monkeypatch
):
    """AC2: a fetch_issue failure is reported clearly, no branch/epic dir created."""
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    def _raise(issue_number):
        raise RuntimeError("gh issue view ... failed: 404 Not Found")

    monkeypatch.setattr("datum.github_issues.fetch_issue", _raise)

    runner = CliRunner()
    result = runner.invoke(app, ["ticket-from-issue", "999"])

    assert result.exit_code != 0
    assert "404" in result.output or "failed" in result.output.lower()
    assert _branch(repo) == "main"
