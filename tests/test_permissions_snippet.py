"""`datum permissions-snippet`: prints the auto-mode allow rules a consumer
repo's operator can paste into .claude/settings.local.json. datum prints and
documents these; it never writes them (the tool must not grant itself the
permissions it needs)."""

from __future__ import annotations

import json

from typer.testing import CliRunner

from datum.cli import app
from datum.permissions import AUTO_MODE_ALLOW_RULES, permissions_snippet


def test_snippet_is_valid_json_with_defaults_first_and_both_rules():
    snippet = json.loads(permissions_snippet())
    allow = snippet["autoMode"]["allow"]
    assert allow[0] == "$defaults"
    assert allow[1:] == list(AUTO_MODE_ALLOW_RULES)
    assert len(AUTO_MODE_ALLOW_RULES) == 2


def test_rules_scope_to_datum_worktrees_and_never_allow_push_or_pr():
    text = " ".join(AUTO_MODE_ALLOW_RULES)
    assert "/.datum/worktrees/" in text
    assert "__bo=$(mktemp)" in text
    assert "does not itself run 'git push'" in text
    for forbidden in ("allow git push", "allow gh pr"):
        assert forbidden not in text


def test_cli_prints_the_snippet_and_nothing_else():
    res = CliRunner().invoke(app, ["permissions-snippet"])
    assert res.exit_code == 0, res.output
    assert json.loads(res.output)["autoMode"]["allow"][0] == "$defaults"


def test_cli_never_writes_settings(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    CliRunner().invoke(app, ["permissions-snippet"])
    assert not (tmp_path / ".claude").exists()
