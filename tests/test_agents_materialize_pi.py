"""RED tests for LLM-318: `datum init --runtime pi` writes .datum/roles/<kind>.md.

Entry point: the real CLI in a subprocess (`python -m datum.cli init --runtime pi`),
run in throwaway git repos with HOME pointed at a temp dir. `init` has no
`--runtime` option yet, so every test fails at the CLI today.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

PACKAGE_ROOT = Path(__file__).resolve().parent.parent
KINDS = sorted(
    p.stem.removeprefix("datum-") for p in (PACKAGE_ROOT / "agents").glob("datum-*.md")
)
WRITER_KINDS = ["red", "green", "refactor", "structural", "docs"]


def _git(*args: str, cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


def _make_repo(base: Path, name: str) -> Path:
    r = base / name / "repo"
    r.mkdir(parents=True)
    _git("init", "-q", "-b", "main", cwd=r)
    _git("config", "core.hooksPath", "/dev/null", cwd=r)
    _git("config", "user.email", "test@example.com", cwd=r)
    _git("config", "user.name", "Test", cwd=r)
    (r / "README.md").write_text("hello\n")
    _git("add", "README.md", cwd=r)
    _git("commit", "-q", "-m", "initial commit", cwd=r)
    return r


def _init_pi(repo: Path, home: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "HOME": str(home)}
    env.pop("CLAUDE_PROJECT_DIR", None)
    return subprocess.run(
        [sys.executable, "-m", "datum.cli", "init", "--runtime", "pi", "--name", "x"],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.fixture(scope="module")
def two_repos(tmp_path_factory) -> tuple[Path, Path, subprocess.CompletedProcess[str]]:
    base = tmp_path_factory.mktemp("pi-roles")
    home = base / "home"
    home.mkdir()
    a = _make_repo(base, "a")
    b = _make_repo(base, "b")
    result = _init_pi(a, home)
    _init_pi(b, home)
    return a, b, result


def _role(repo: Path, kind: str) -> str:
    return (repo / ".datum" / "roles" / f"{kind}.md").read_text()


def test_init_runtime_pi_is_accepted(two_repos):
    # Catches: `datum init` has no --runtime option, so a pi consumer cannot ask for role files at all
    _, _, result = two_repos
    assert result.returncode == 0, result.stderr[-400:]


def test_one_role_file_per_agent_definition(two_repos):
    # Catches: a definition with no role file, or stray role files with no definition
    a, _, _ = two_repos
    produced = sorted(p.stem for p in (a / ".datum" / "roles").glob("*.md"))
    assert produced == [
        "cli",
        "docs",
        "green",
        "quality-reader",
        "reader",
        "red",
        "refactor",
        "reflect",
        "reviewer",
        "skeptic",
        "structural",
    ]
    assert produced == KINDS


@pytest.mark.parametrize("kind", KINDS)
def test_role_has_no_frontmatter_fence(two_repos, kind):
    # Catches: frontmatter left in the role text, so pi sees YAML (name, tools, hooks) as part of the system prompt
    a, _, _ = two_repos
    assert [ln for ln in _role(a, kind).splitlines() if ln == "---"] == []


@pytest.mark.parametrize("kind", KINDS)
def test_role_mentions_no_hooks(two_repos, kind):
    # Catches: Claude Code hook wiring (hooks:, PreToolUse, hook paths) copied into a pi role
    a, _, _ = two_repos
    bad = [
        ln
        for ln in _role(a, kind).splitlines()
        if re.search(r"hooks?\b|PreToolUse", ln, re.IGNORECASE)
    ]
    assert bad == []


@pytest.mark.parametrize("kind", WRITER_KINDS)
def test_writer_role_says_do_not_commit(two_repos, kind):
    # Catches: a writer role that never tells the model the runner commits, so it may try git commit in a sandbox with no git
    a, _, _ = two_repos
    assert "do not commit" in _role(a, kind)


@pytest.mark.parametrize("kind", WRITER_KINDS)
def test_writer_role_keeps_no_commit_instruction(two_repos, kind):
    # Catches: the original "Commit with the exact commit command the prompt gives" step surviving next to "do not commit"
    a, _, _ = two_repos
    bad = [
        ln
        for ln in _role(a, kind).splitlines()
        if re.search(r"commit with the exact|commit_prefix|git commit", ln, re.IGNORECASE)
    ]
    assert bad == []


@pytest.mark.parametrize("kind", KINDS)
def test_role_bytes_identical_across_two_repos(two_repos, kind):
    # Catches: per-checkout variation in a role file, which changes the prompt prefix and cold-starts Ornith's KV cache
    a, b, _ = two_repos
    assert (a / ".datum" / "roles" / f"{kind}.md").read_bytes() == (
        b / ".datum" / "roles" / f"{kind}.md"
    ).read_bytes()


@pytest.mark.parametrize("kind", KINDS)
def test_role_holds_nothing_per_run(two_repos, kind):
    # Catches: a date, repo path or home path baked into a role, breaking byte stability between runs and machines
    a, b, _ = two_repos
    text = _role(a, kind)
    assert re.findall(r"\d{4}-\d{2}-\d{2}", text) == []
    assert str(a) not in text and str(b) not in text
    assert re.findall(r"/(?:home|Users|tmp|srv)/", text) == []
