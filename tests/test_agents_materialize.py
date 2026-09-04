"""Tests for agent-type + hook materialisation on ``datum init`` (#368).

The ``agents/*.md`` definitions reference their hooks as
``$CLAUDE_PROJECT_DIR/assets/hooks/<name>.sh`` — a path that only exists
inside the datum repo. A consumer repo therefore needs (a) the agent files
copied into ``<repo>/.claude/agents/`` and (b) the referenced hooks copied
into ``<repo>/.datum/hooks/`` with the reference rewritten to the absolute
materialised path, so the hook fires even when ``CLAUDE_PROJECT_DIR`` is
unset.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.agents_materialize import (
    AGENTS_SUBDIR,
    HOOK_REF_PREFIX,
    LOCAL_HOOKS_SUBDIR,
    MATERIALISED_MARKER,
    install_agent_types,
    materialize_agents,
    materialize_hooks,
    referenced_hooks,
    render_agent,
)
from datum.cli import app

REAL_ROOT = Path(__file__).resolve().parent.parent

AGENT_WITH_HOOKS = """---
name: datum-red
description: Use for RED.
tools: Read, Write
model: sonnet
hooks:
  PreToolUse:
    - matcher: "Write"
      hooks:
        - type: command
          command: "$CLAUDE_PROJECT_DIR/assets/hooks/pre-tool-use-protect-tests.sh"
  PostToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "$CLAUDE_PROJECT_DIR/assets/hooks/post-tool-use-test-ratchet-live.sh"
---

Body line.
"""

AGENT_NO_HOOKS = """---
name: datum-reader
description: Use for reads.
tools: Read
model: haiku
---

Read only.
"""


def _make_package(tmp_path: Path) -> Path:
    pkg = tmp_path / "pkg"
    agents = pkg / "agents"
    hooks = pkg / "assets" / "hooks"
    agents.mkdir(parents=True)
    hooks.mkdir(parents=True)
    (agents / "datum-red.md").write_text(AGENT_WITH_HOOKS)
    (agents / "datum-reader.md").write_text(AGENT_NO_HOOKS)
    (agents / "README.md").write_text("# not an agent\n")
    for name in (
        "pre-tool-use-protect-tests.sh",
        "post-tool-use-test-ratchet-live.sh",
        "pre-tool-use-commit-format.sh",  # exists but unreferenced
        "pre-commit-banned-patterns.sh",  # git hook, never materialised
    ):
        p = hooks / name
        p.write_text("#!/usr/bin/env bash\nexit 0\n")
        p.chmod(0o755)
    (hooks / "test_pre-tool-use-x.sh").write_text("#!/usr/bin/env bash\n")
    return pkg


# ── pure helpers ──


def test_referenced_hooks_lists_only_hooks_agents_reference(tmp_path):
    pkg = _make_package(tmp_path)

    assert referenced_hooks(pkg / "agents") == [
        "post-tool-use-test-ratchet-live.sh",
        "pre-tool-use-protect-tests.sh",
    ]


def test_render_agent_rewrites_every_hook_ref_to_absolute_path(tmp_path):
    hooks_dir = tmp_path / "repo" / ".datum" / "hooks"

    out = render_agent(AGENT_WITH_HOOKS, hooks_dir, source_name="datum-red.md")

    assert HOOK_REF_PREFIX not in out
    assert f'"{hooks_dir}/pre-tool-use-protect-tests.sh"' in out
    assert f'"{hooks_dir}/post-tool-use-test-ratchet-live.sh"' in out
    assert MATERIALISED_MARKER in out
    # frontmatter is still the first thing in the file
    assert out.startswith("---\nname: datum-red\n")
    assert "Body line." in out


def test_render_agent_is_a_noop_when_nothing_to_rewrite_except_marker(tmp_path):
    out = render_agent(AGENT_NO_HOOKS, tmp_path, source_name="datum-reader.md")
    assert "Read only." in out
    assert MATERIALISED_MARKER in out
    assert out.count("---\n") == 2


# ── hooks ──


def test_materialize_hooks_copies_referenced_hooks_with_exec_bit(tmp_path):
    pkg = _make_package(tmp_path)
    dest = tmp_path / "repo" / ".datum" / "hooks"

    written = materialize_hooks(
        pkg / "assets" / "hooks", dest, referenced_hooks(pkg / "agents")
    )

    assert written == [
        "post-tool-use-test-ratchet-live.sh",
        "pre-tool-use-protect-tests.sh",
    ]
    for name in written:
        mode = (dest / name).stat().st_mode
        assert mode & stat.S_IXUSR, f"{name} lost its executable bit"
        assert not (dest / name).is_symlink()
    assert not (dest / "pre-tool-use-commit-format.sh").exists()
    assert not (dest / "pre-commit-banned-patterns.sh").exists()
    assert not (dest / "test_pre-tool-use-x.sh").exists()


def test_materialize_hooks_refuses_non_tool_use_names(tmp_path):
    pkg = _make_package(tmp_path)
    dest = tmp_path / "repo" / ".datum" / "hooks"

    written = materialize_hooks(
        pkg / "assets" / "hooks", dest, ["pre-commit-banned-patterns.sh"]
    )

    assert written == []
    assert not (dest / "pre-commit-banned-patterns.sh").exists()


def test_materialize_hooks_idempotent_and_recopies_on_source_change(tmp_path):
    pkg = _make_package(tmp_path)
    src = pkg / "assets" / "hooks"
    dest = tmp_path / "repo" / ".datum" / "hooks"
    names = referenced_hooks(pkg / "agents")
    materialize_hooks(src, dest, names)

    assert materialize_hooks(src, dest, names) == []

    (src / "pre-tool-use-protect-tests.sh").write_text("#!/usr/bin/env bash\nexit 2\n")
    assert materialize_hooks(src, dest, names) == ["pre-tool-use-protect-tests.sh"]
    assert (dest / "pre-tool-use-protect-tests.sh").read_text().endswith("exit 2\n")


# ── agents ──


def test_materialize_agents_copies_datum_md_only_and_rewrites(tmp_path):
    pkg = _make_package(tmp_path)
    dest = tmp_path / "repo" / ".claude" / "agents"
    hooks_dir = tmp_path / "repo" / ".datum" / "hooks"

    written, skipped = materialize_agents(pkg / "agents", dest, hooks_dir)

    assert written == ["datum-reader.md", "datum-red.md"]
    assert skipped == []
    assert not (dest / "README.md").exists()
    red = (dest / "datum-red.md").read_text()
    assert HOOK_REF_PREFIX not in red
    assert str(hooks_dir / "pre-tool-use-protect-tests.sh") in red
    assert not (dest / "datum-red.md").is_symlink()


def test_materialize_agents_idempotent_and_tracks_source_and_hooks_dir(tmp_path):
    pkg = _make_package(tmp_path)
    dest = tmp_path / "repo" / ".claude" / "agents"
    hooks_dir = tmp_path / "repo" / ".datum" / "hooks"
    materialize_agents(pkg / "agents", dest, hooks_dir)

    assert materialize_agents(pkg / "agents", dest, hooks_dir) == ([], [])

    (pkg / "agents" / "datum-reader.md").write_text(
        AGENT_NO_HOOKS.replace("Read only.", "Read only, v2.")
    )
    written, _ = materialize_agents(pkg / "agents", dest, hooks_dir)
    assert written == ["datum-reader.md"]
    assert "Read only, v2." in (dest / "datum-reader.md").read_text()

    # Repo moved → hooks dir changed → the rewritten refs must follow it.
    other_hooks = tmp_path / "elsewhere" / ".datum" / "hooks"
    written, _ = materialize_agents(pkg / "agents", dest, other_hooks)
    assert written == ["datum-red.md"]
    assert str(other_hooks) in (dest / "datum-red.md").read_text()


def test_materialize_agents_never_overwrites_a_non_datum_file(tmp_path):
    pkg = _make_package(tmp_path)
    dest = tmp_path / "repo" / ".claude" / "agents"
    dest.mkdir(parents=True)
    hand_written = "---\nname: datum-red\ndescription: mine\n---\nmy own agent\n"
    (dest / "datum-red.md").write_text(hand_written)
    (dest / "my-agent.md").write_text("---\nname: my-agent\n---\nkeep me\n")

    written, skipped = materialize_agents(
        pkg / "agents", dest, tmp_path / "hooks", force=True
    )

    assert written == ["datum-reader.md"]
    assert skipped == ["datum-red.md"]
    assert (dest / "datum-red.md").read_text() == hand_written
    assert (dest / "my-agent.md").read_text().endswith("keep me\n")


def test_materialize_agents_force_overwrites_locally_edited_datum_copy(tmp_path):
    pkg = _make_package(tmp_path)
    dest = tmp_path / "repo" / ".claude" / "agents"
    hooks_dir = tmp_path / "repo" / ".datum" / "hooks"
    materialize_agents(pkg / "agents", dest, hooks_dir)
    edited = (dest / "datum-reader.md").read_text() + "\nlocal tweak\n"
    (dest / "datum-reader.md").write_text(edited)

    written, skipped = materialize_agents(pkg / "agents", dest, hooks_dir, force=True)

    assert "datum-reader.md" in written
    assert skipped == []
    assert "local tweak" not in (dest / "datum-reader.md").read_text()


# ── install_agent_types (the seam datum init calls) ──


def test_install_agent_types_materialises_and_reports_success(tmp_path):
    pkg = _make_package(tmp_path)
    repo = tmp_path / "repo"
    repo.mkdir()

    res = install_agent_types(repo, pkg)

    assert res.agents_dir == (repo / AGENTS_SUBDIR).resolve()
    assert res.hooks_dir == (repo / LOCAL_HOOKS_SUBDIR).resolve()
    assert res.agents_written == ["datum-reader.md", "datum-red.md"]
    assert res.hooks_written == [
        "post-tool-use-test-ratchet-live.sh",
        "pre-tool-use-protect-tests.sh",
    ]
    assert res.errors == []
    assert res.agent_types is True
    assert res.hooks_installed is True
    # second run: nothing rewritten, still reported installed
    again = install_agent_types(repo, pkg)
    assert again.agents_written == [] and again.hooks_written == []
    assert again.agent_types is True and again.hooks_installed is True


def test_install_agent_types_reports_false_when_a_hook_is_missing(tmp_path):
    pkg = _make_package(tmp_path)
    (pkg / "assets" / "hooks" / "pre-tool-use-protect-tests.sh").unlink()
    repo = tmp_path / "repo"
    repo.mkdir()

    res = install_agent_types(repo, pkg)

    assert res.hooks_installed is False
    assert any("pre-tool-use-protect-tests.sh" in e for e in res.errors)
    # agents still materialised — a missing hook must not take them down
    assert (repo / AGENTS_SUBDIR / "datum-red.md").is_file()


def test_install_agent_types_reports_false_when_agent_copy_is_skipped(tmp_path):
    pkg = _make_package(tmp_path)
    repo = tmp_path / "repo"
    dest = repo / AGENTS_SUBDIR
    dest.mkdir(parents=True)
    (dest / "datum-red.md").write_text("---\nname: datum-red\n---\nmine\n")

    res = install_agent_types(repo, pkg)

    assert res.agent_types is False
    assert res.skipped == ["datum-red.md"]
    assert res.hooks_installed is True


def test_install_agent_types_swallows_exceptions_into_errors(tmp_path, monkeypatch):
    pkg = _make_package(tmp_path)
    repo = tmp_path / "repo"
    repo.mkdir()

    def boom(*a, **k):
        raise OSError("disk on fire")

    monkeypatch.setattr("datum.agents_materialize.materialize_hooks", boom)

    res = install_agent_types(repo, pkg)

    assert res.hooks_installed is False
    assert any("disk on fire" in e for e in res.errors)


def test_install_agent_types_links_claude_agents_inside_datum_repo(tmp_path):
    # A self-hosted checkout (repo_root == package_root) needs
    # <repo>/.claude/agents -> ../agents so Claude Code's own agent-type
    # resolution (which reads .claude/agents/*.md, not agents/*.md) can see
    # the datum-* agents. install.sh creates this symlink, but nothing
    # guaranteed it had ever been run — a checkout that skipped install.sh
    # previously got a lying `agent_types: true` even though
    # .claude/agents didn't exist and every agentType lookup would fail.
    pkg = _make_package(tmp_path)
    assert not (pkg / AGENTS_SUBDIR).exists()

    res = install_agent_types(pkg, pkg)

    assert res.agents_dir == pkg / AGENTS_SUBDIR
    assert res.hooks_dir == (pkg / "assets" / "hooks").resolve()
    assert (pkg / AGENTS_SUBDIR).is_symlink()
    assert (pkg / AGENTS_SUBDIR / "datum-red.md").is_file()
    assert res.agent_types is True and res.hooks_installed is True
    assert not (pkg / LOCAL_HOOKS_SUBDIR).exists()

    # second run: symlink already present, left alone, still reported installed
    again = install_agent_types(pkg, pkg)
    assert (pkg / AGENTS_SUBDIR).is_symlink()
    assert again.agent_types is True and again.hooks_installed is True


def test_install_agent_types_leaves_an_existing_claude_agents_dir_alone_inside_datum_repo(
    tmp_path,
):
    # If .claude/agents already exists (e.g. a real directory rather than
    # the install.sh symlink) it must never be clobbered.
    pkg = _make_package(tmp_path)
    dest = pkg / AGENTS_SUBDIR
    dest.mkdir(parents=True)
    (dest / "hand-written.md").write_text("---\nname: hand-written\n---\nmine\n")

    res = install_agent_types(pkg, pkg)

    assert not (pkg / AGENTS_SUBDIR).is_symlink()
    assert (dest / "hand-written.md").is_file()
    # the datum-* agents were never actually placed here, so agent_types
    # must honestly report false rather than claim success
    assert res.agent_types is False


# ── the real hooks run from the materialised path ──


@pytest.mark.skipif(shutil.which("jq") is None, reason="hooks need jq")
def test_real_hook_runs_from_materialised_path_without_project_dir(tmp_path):
    repo = tmp_path / "consumer"
    repo.mkdir()
    res = install_agent_types(repo, REAL_ROOT)
    assert res.hooks_installed is True, res.errors

    hook = res.hooks_dir / "pre-tool-use-lane-file-guard.sh"
    assert hook.is_file() and os.access(hook, os.X_OK)
    # the rendered agent points at exactly this file
    assert str(hook) in (res.agents_dir / "datum-red.md").read_text()

    (repo / ".datum" / "lane-context.json").write_text(
        json.dumps(
            {
                "stage": "red",
                "task_id": "T1",
                "allowed_write_files": ["tests/test_x.py"],
                "forbidden_write_files": ["src/x.py"],
            }
        )
    )
    env = {k: v for k, v in os.environ.items() if k != "CLAUDE_PROJECT_DIR"}
    payload = json.dumps({"tool_input": {"file_path": "src/x.py"}})

    proc = subprocess.run(
        [str(hook)], input=payload, cwd=repo, env=env, capture_output=True, text=True
    )

    assert proc.returncode == 2, proc.stderr
    assert "BLOCKED" in proc.stderr

    ok = subprocess.run(
        [str(hook)],
        input=json.dumps({"tool_input": {"file_path": "tests/test_x.py"}}),
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
    )
    assert ok.returncode == 0, ok.stderr


# ── CLI ──


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


def test_init_materialises_agents_and_hooks_and_sets_config_flags(
    tmp_path, monkeypatch
):
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = CliRunner().invoke(app, ["init", "--name", "agents-test"])

    assert result.exit_code == 0, result.output
    agents = repo / AGENTS_SUBDIR
    hooks = repo / LOCAL_HOOKS_SUBDIR
    for src in sorted((REAL_ROOT / "agents").glob("datum-*.md")):
        assert (agents / src.name).is_file(), src.name
        assert HOOK_REF_PREFIX not in (agents / src.name).read_text()
    for name in referenced_hooks(REAL_ROOT / "agents"):
        assert os.access(hooks / name, os.X_OK), name
    cfg = json.loads((repo / ".datum" / "config.json").read_text())
    assert cfg["hooks_installed"] is True
    assert cfg["agent_types"] is True


def test_init_refresh_covers_skills_agents_and_hooks_without_bootstrap(
    tmp_path, monkeypatch
):
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (repo / ".datum").mkdir()
    (repo / ".datum" / "config.json").write_text(json.dumps({"language": "python"}))
    stale_agents = repo / AGENTS_SUBDIR
    stale_agents.mkdir(parents=True)
    stale_agents.joinpath("datum-red.md").write_text(
        f"---\nname: datum-red\n---\n{MATERIALISED_MARKER} agents/datum-red.md -->\nstale\n"
    )

    result = CliRunner().invoke(app, ["init", "--refresh", "--json"])

    assert result.exit_code == 0, result.output
    out = json.loads(result.output.strip().splitlines()[-1])
    assert out["refreshed"] is True
    assert out["agentsDir"] == str((repo / AGENTS_SUBDIR).resolve())
    assert out["hooksDir"] == str((repo / LOCAL_HOOKS_SUBDIR).resolve())
    assert "stale" not in (stale_agents / "datum-red.md").read_text()
    assert (repo / ".datum" / "skills" / "datum-go.js").is_file()
    cfg = json.loads((repo / ".datum" / "config.json").read_text())
    assert cfg["language"] == "python"
    assert cfg["hooks_installed"] is True
    assert cfg["agent_types"] is True
    assert _branch(repo) == "main"
    assert not (repo / "docs").exists()


def test_init_refresh_skills_is_an_alias_for_refresh(tmp_path, monkeypatch):
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = CliRunner().invoke(app, ["init", "--refresh-skills"])

    assert result.exit_code == 0, result.output
    assert (repo / AGENTS_SUBDIR / "datum-cli.md").is_file()
    assert (repo / ".datum" / "skills" / "datum-go.js").is_file()


def test_init_writes_false_flags_when_materialisation_fails(tmp_path, monkeypatch):
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    def boom(*a, **k):
        raise OSError("no space left")

    monkeypatch.setattr("datum.agents_materialize.materialize_hooks", boom)

    result = CliRunner().invoke(app, ["init", "--refresh", "--json"])

    assert result.exit_code == 0, result.output
    cfg = json.loads((repo / ".datum" / "config.json").read_text())
    assert cfg["hooks_installed"] is False
    assert cfg["agent_types"] is False
