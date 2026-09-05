"""Characterization tests for datum.gate.resolve_artifact and resolve_epic_dir.

resolve_artifact() is the SSOT for artifact path resolution (epic-scoped
docs/epics/<branch>/<name> vs legacy/root <name>) and has 13 call sites in
gate.py but had zero direct tests. These tests pin the CURRENT behavior of
every branch: both-exist mtime comparison, epic-only, root-only, neither,
absolute-path inputs, empty-name, and the git-branch-resolution fallback
used to build the epic dir.
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import pytest

from datum.gate import resolve_artifact, resolve_epic_dir


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, check=True
    )


def _init_repo(repo: Path, branch: str = "datum/epic-1") -> str:
    repo.mkdir(parents=True, exist_ok=True)
    _git(["init", "-q", "-b", branch], cwd=repo)
    _git(["config", "user.email", "t@example.com"], cwd=repo)
    _git(["config", "user.name", "T"], cwd=repo)
    (repo / "README.md").write_text("# fixture\n")
    _git(["add", "README.md"], cwd=repo)
    _git(["commit", "-q", "-m", "init"], cwd=repo)
    return branch


# ── resolve_epic_dir() ───────────────────────────────────────────────────


def test_resolve_epic_dir_uses_current_branch_name(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    branch = _init_repo(repo, branch="feature/foo")
    monkeypatch.chdir(repo)

    assert resolve_epic_dir() == Path(f"docs/epics/{branch}")


def test_resolve_epic_dir_outside_git_repo_falls_back_to_unknown(tmp_path, monkeypatch):
    """BUG (fixed): git rev-parse fails with returncode=128 and empty stdout
    when cwd is not inside a git repo. The old code only caught
    TimeoutExpired/FileNotFoundError, not a non-zero exit with blank stdout,
    so `branch` silently became "" and the epic dir collapsed to
    docs/epics (no branch segment at all), which is str.strip()'d and
    Path-normalized away. This pins the fixed "unknown" fallback."""
    outside = tmp_path / "not_a_repo"
    outside.mkdir()
    monkeypatch.chdir(outside)

    assert resolve_epic_dir() == Path("docs/epics/unknown")


def test_resolve_epic_dir_missing_git_binary_falls_back_to_unknown(
    tmp_path, monkeypatch
):
    repo = tmp_path / "repo"
    _init_repo(repo)
    monkeypatch.chdir(repo)

    real_run = subprocess.run

    def fake_run(cmd, *args, **kwargs):
        if cmd and cmd[0] == "git":
            raise FileNotFoundError("git not found")
        return real_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert resolve_epic_dir() == Path("docs/epics/unknown")


def test_resolve_epic_dir_git_timeout_falls_back_to_unknown(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    _init_repo(repo)
    monkeypatch.chdir(repo)

    def fake_run(cmd, *args, **kwargs):
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=5)

    monkeypatch.setattr(subprocess, "run", fake_run)
    assert resolve_epic_dir() == Path("docs/epics/unknown")


# ── resolve_artifact(): both exist ──────────────────────────────────────


def test_resolve_artifact_prefers_epic_dir_when_mtimes_equal_or_epic_newer(
    tmp_path, monkeypatch
):
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    (epic_dir / "SPEC.md").write_text("epic version")
    (repo / "SPEC.md").write_text("root version")

    # Make epic copy strictly newer than root copy.
    epic_file = epic_dir / "SPEC.md"
    root_file = repo / "SPEC.md"
    now = time.time()
    os.utime(root_file, (now - 100, now - 100))
    os.utime(epic_file, (now, now))

    result = resolve_artifact("SPEC.md")
    assert result.resolve() == epic_file.resolve()
    assert result.read_text() == "epic version"


def test_resolve_artifact_uses_root_when_root_is_strictly_newer(
    tmp_path, monkeypatch, capsys
):
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    epic_file = epic_dir / "SPEC.md"
    root_file = repo / "SPEC.md"
    epic_file.write_text("epic version")
    root_file.write_text("root version")

    now = time.time()
    os.utime(epic_file, (now - 100, now - 100))
    os.utime(root_file, (now, now))

    result = resolve_artifact("SPEC.md")
    assert result.resolve() == root_file.resolve()
    assert result.read_text() == "root version"

    # Caller-visible warning on stderr when root wins over epic dir.
    captured = capsys.readouterr()
    assert "newer than epic-dir copy" in captured.err


def test_resolve_artifact_equal_mtimes_prefers_epic_dir(tmp_path, monkeypatch):
    """Ties go to the epic dir: `>` (strictly greater), not `>=`."""
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    epic_file = epic_dir / "SPEC.md"
    root_file = repo / "SPEC.md"
    epic_file.write_text("epic version")
    root_file.write_text("root version")

    same = time.time()
    os.utime(epic_file, (same, same))
    os.utime(root_file, (same, same))

    result = resolve_artifact("SPEC.md")
    assert result.resolve() == epic_file.resolve()


# ── resolve_artifact(): only one exists ─────────────────────────────────


def test_resolve_artifact_epic_only_returns_epic_path(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)
    (epic_dir / "TASKS.md").write_text("epic tasks")

    result = resolve_artifact("TASKS.md")
    assert result.resolve() == (epic_dir / "TASKS.md").resolve()
    assert result.exists()


def test_resolve_artifact_root_only_returns_root_path(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    _init_repo(repo)
    monkeypatch.chdir(repo)

    (repo / "TASKS.md").write_text("root tasks")

    result = resolve_artifact("TASKS.md")
    assert result == Path("TASKS.md")
    assert result.exists()


def test_resolve_artifact_neither_exists_returns_nonexistent_epic_path(
    tmp_path, monkeypatch
):
    """Fallback for writers: when nothing exists yet, resolve_artifact still
    returns a path (under the epic dir) rather than raising or returning
    None, so a caller can write to it. This is a deliberate default-to-epic
    fallback, not an error path — callers are expected to check .exists()."""
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    result = resolve_artifact("PROPERTIES.md")
    assert result == Path(f"docs/epics/{branch}/PROPERTIES.md")
    assert not result.exists()


# ── resolve_artifact(): unusual name inputs ─────────────────────────────


def test_resolve_artifact_absolute_path_name_collapses_epic_and_root_to_same_path(
    tmp_path, monkeypatch
):
    """Path.__truediv__ with an absolute right-hand side discards the left
    side entirely (pathlib semantics), so passing an absolute path as `name`
    makes epic_path == root_path — the epic-dir/root distinction is a no-op
    for absolute inputs. Pinning this so a future refactor can't silently
    change it without a test failing."""
    repo = tmp_path / "repo"
    _init_repo(repo)
    monkeypatch.chdir(repo)

    abs_file = tmp_path / "outside.md"
    abs_file.write_text("absolute content")

    result = resolve_artifact(str(abs_file))
    assert result == abs_file
    assert result.read_text() == "absolute content"


def test_resolve_artifact_empty_name_resolves_to_epic_dir_itself(tmp_path, monkeypatch):
    """Path(x) / "" == Path(x); Path("") == Path("."). So an empty name
    makes epic_path the epic dir itself and root_path the cwd. Both are
    directories that exist once the epic dir has been created."""
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch
    epic_dir.mkdir(parents=True)

    result = resolve_artifact("")
    assert result.resolve() == epic_dir.resolve()


def test_resolve_artifact_none_name_raises_type_error(tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    _init_repo(repo)
    monkeypatch.chdir(repo)

    with pytest.raises(TypeError):
        resolve_artifact(None)  # type: ignore[arg-type]


def test_resolve_artifact_nested_subpath_name_is_joined_under_epic_dir(
    tmp_path, monkeypatch
):
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    epic_dir = repo / "docs" / "epics" / branch / "sub"
    epic_dir.mkdir(parents=True)
    (epic_dir / "notes.md").write_text("nested")

    result = resolve_artifact("sub/notes.md")
    assert (
        result.resolve()
        == (repo / "docs" / "epics" / branch / "sub" / "notes.md").resolve()
    )
    assert result.read_text() == "nested"


def test_resolve_artifact_traversal_name_is_not_sanitized(tmp_path, monkeypatch):
    """resolve_artifact does not sanitize `..` path segments; it just joins
    them. This documents current (unsafe-looking but never exercised with
    untrusted input) behavior rather than asserting it is safe."""
    repo = tmp_path / "repo"
    branch = _init_repo(repo)
    monkeypatch.chdir(repo)

    outside_target = repo / "docs" / "epics" / "datum" / "sibling.md"
    outside_target.parent.mkdir(parents=True, exist_ok=True)
    outside_target.write_text("sibling content")

    result = resolve_artifact("../sibling.md")
    assert result == Path(f"docs/epics/{branch}/../sibling.md")
    assert result.resolve() == outside_target.resolve()
