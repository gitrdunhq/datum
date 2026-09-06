"""`datum gitignore-check` — preflight demand for a robust .gitignore.

Every scratch path datum writes into a consumer repo (.datum/worktrees/,
.datum/runs/, .datum/skills/, .datum/hooks/, .temp/) must be ignored, or
untracked generated files end up in `git add .`, collide with lane
squash-merges ("untracked working tree files would be overwritten"), and get
blamed on agents. The check asks git itself (`git check-ignore`) so nested
.gitignore files and negations are honoured.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from typer.testing import CliRunner

from datum.cli import app
from datum.gitignore_check import REQUIRED_IGNORES, check_gitignore, fix_gitignore


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )


def _repo(tmp_path: Path, gitignore: str | None) -> Path:
    _git(["init", "-q", "-b", "main"], tmp_path)
    _git(["config", "core.hooksPath", "/dev/null"], tmp_path)
    if gitignore is not None:
        (tmp_path / ".gitignore").write_text(gitignore)
    return tmp_path


def test_required_ignores_cover_every_scratch_dir_datum_writes():
    assert {
        ".datum/worktrees/",
        ".datum/runs/",
        ".datum/skills/",
        ".datum/hooks/",
        ".temp/",
    } <= set(REQUIRED_IGNORES)


def test_missing_gitignore_reports_every_required_pattern(tmp_path):
    repo = _repo(tmp_path, None)
    result = check_gitignore(repo)
    assert result["ok"] is False
    assert set(result["missing"]) == set(REQUIRED_IGNORES)


def test_blanket_datum_ignore_satisfies_the_datum_entries(tmp_path):
    # datum's own style: `.datum/*` with negations for committed config.
    repo = _repo(tmp_path, ".datum/*\n!.datum/config.toml\n.temp/\n")
    result = check_gitignore(repo)
    assert result["ok"] is True, result
    assert result["missing"] == []


def test_partial_gitignore_reports_only_the_gaps(tmp_path):
    repo = _repo(tmp_path, ".datum/worktrees/\n.temp/\n")
    result = check_gitignore(repo)
    assert result["ok"] is False
    assert set(result["missing"]) == {".datum/runs/", ".datum/skills/", ".datum/hooks/"}


def test_negated_scratch_dir_counts_as_missing(tmp_path):
    repo = _repo(tmp_path, ".datum/*\n!.datum/runs/\n.temp/\n")
    result = check_gitignore(repo)
    assert ".datum/runs/" in result["missing"]


def test_fix_appends_only_the_missing_patterns_and_is_idempotent(tmp_path):
    repo = _repo(tmp_path, ".temp/\n")
    added = fix_gitignore(repo)
    assert set(added) == set(REQUIRED_IGNORES) - {".temp/"}
    assert check_gitignore(repo)["ok"] is True
    text = (repo / ".gitignore").read_text()
    assert text.startswith(".temp/\n")  # existing content preserved
    assert "# datum" in text
    # Second run adds nothing and does not duplicate the block.
    assert fix_gitignore(repo) == []
    assert (repo / ".gitignore").read_text() == text


def test_fix_creates_gitignore_when_absent(tmp_path):
    repo = _repo(tmp_path, None)
    added = fix_gitignore(repo)
    assert set(added) == set(REQUIRED_IGNORES)
    assert check_gitignore(repo)["ok"] is True


def test_cli_exits_1_with_json_listing_missing(tmp_path, monkeypatch):
    repo = _repo(tmp_path, ".temp/\n")
    monkeypatch.chdir(repo)
    result = CliRunner().invoke(app, ["gitignore-check"])
    assert result.exit_code == 1, result.output
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert ".datum/worktrees/" in payload["missing"]
    assert "--fix" in payload["hint"]


def test_cli_fix_exits_0_and_reports_added(tmp_path, monkeypatch):
    repo = _repo(tmp_path, ".temp/\n")
    monkeypatch.chdir(repo)
    result = CliRunner().invoke(app, ["gitignore-check", "--fix"])
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert ".datum/worktrees/" in payload["added"]


def test_cli_ok_exits_0(tmp_path, monkeypatch):
    repo = _repo(tmp_path, ".datum/*\n.temp/\n")
    monkeypatch.chdir(repo)
    result = CliRunner().invoke(app, ["gitignore-check"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout) == {"ok": True, "missing": [], "added": []}
