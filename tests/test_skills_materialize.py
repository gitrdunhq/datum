"""Tests for repo-local skill materialisation (#353).

The Claude Code Workflow harness refuses any `scriptPath` whose real path is
outside the session working directory (symlinks are resolved first). So
`datum init` must COPY the compiled `skills/*.js` into a repo-local,
gitignored `.datum/skills/` and point `skills_dir` there — except in the
datum repo itself, where the package skills dir already lives inside the
repo and is used in place.
"""

import json
import subprocess

from typer.testing import CliRunner

from datum.cli import app
from datum.skills_materialize import (
    LOCAL_SKILLS_SUBDIR,
    materialize_skills,
    resolve_skills_dir,
)


def _make_source(tmp_path):
    src = tmp_path / "pkg" / "skills"
    src.mkdir(parents=True)
    (src / "datum-go.js").write_text("// go v1\n")
    (src / "datum-plan.js").write_text("// plan v1\n")
    (src / "datum-go.ts").write_text("// not a compiled skill\n")
    (src / "tsconfig.json").write_text("{}\n")
    return src


def test_materialize_copies_only_compiled_datum_js(tmp_path):
    src = _make_source(tmp_path)
    dest = tmp_path / "repo" / ".datum" / "skills"

    copied = materialize_skills(src, dest)

    assert sorted(copied) == ["datum-go.js", "datum-plan.js"]
    assert (dest / "datum-go.js").read_text() == "// go v1\n"
    assert (dest / "datum-plan.js").read_text() == "// plan v1\n"
    assert not (dest / "datum-go.ts").exists()
    assert not (dest / "tsconfig.json").exists()
    # Real files, never symlinks — the harness resolves symlinks to their target.
    assert not (dest / "datum-go.js").is_symlink()


def test_materialize_is_idempotent_and_tracks_source_changes(tmp_path):
    src = _make_source(tmp_path)
    dest = tmp_path / "repo" / ".datum" / "skills"
    materialize_skills(src, dest)

    assert materialize_skills(src, dest) == []

    (src / "datum-go.js").write_text("// go v2\n")
    assert materialize_skills(src, dest) == ["datum-go.js"]
    assert (dest / "datum-go.js").read_text() == "// go v2\n"


def test_materialize_force_overwrites_local_edits(tmp_path):
    src = _make_source(tmp_path)
    dest = tmp_path / "repo" / ".datum" / "skills"
    materialize_skills(src, dest)
    (dest / "datum-go.js").write_text("// local hack\n")

    # Without force a local edit differs from source and is re-copied anyway
    # (content comparison), so force must at minimum re-copy everything.
    copied = materialize_skills(src, dest, force=True)

    assert sorted(copied) == ["datum-go.js", "datum-plan.js"]
    assert (dest / "datum-go.js").read_text() == "// go v1\n"


def test_materialize_missing_source_returns_empty(tmp_path):
    dest = tmp_path / "repo" / ".datum" / "skills"
    assert materialize_skills(tmp_path / "nope", dest) == []
    assert not dest.exists()


def test_resolve_skills_dir_uses_package_dir_when_inside_repo(tmp_path):
    repo = tmp_path / "datum-repo"
    src = repo / "skills"
    src.mkdir(parents=True)
    (src / "datum-go.js").write_text("// go\n")

    resolved = resolve_skills_dir(repo, src)

    assert resolved == src.resolve()
    assert not (repo / LOCAL_SKILLS_SUBDIR).exists()


def test_resolve_skills_dir_materializes_when_package_is_outside_repo(tmp_path):
    src = _make_source(tmp_path)
    repo = tmp_path / "consumer"
    repo.mkdir()

    resolved = resolve_skills_dir(repo, src)

    assert resolved == (repo / LOCAL_SKILLS_SUBDIR).resolve()
    assert (resolved / "datum-go.js").read_text() == "// go v1\n"


# ── CLI ──


def _git_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "t@example.com"], cwd=path, check=True
    )
    subprocess.run(["git", "config", "user.name", "T"], cwd=path, check=True)
    (path / "README.md").write_text("# fixture\n")
    subprocess.run(["git", "add", "."], cwd=path, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "init"], cwd=path, check=True)


def _branch(path):
    return subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=path,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()


def test_init_materializes_local_skills_and_points_config_there(tmp_path, monkeypatch):
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))

    result = CliRunner().invoke(app, ["init", "--name", "skills-test"])

    assert result.exit_code == 0, result.output
    local = repo / LOCAL_SKILLS_SUBDIR
    assert (local / "datum-go.js").is_file()
    assert not (local / "datum-go.js").is_symlink()
    cfg = json.loads((repo / ".datum" / "config.json").read_text())
    assert cfg["skills_dir"] == str(local.resolve())


def test_init_refresh_skills_only_recopies_and_fixes_stale_skills_dir(
    tmp_path, monkeypatch
):
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    (repo / ".datum").mkdir()
    (repo / ".datum" / "config.json").write_text(
        json.dumps({"language": "python", "skills_dir": "/somewhere/else/skills"})
    )

    result = CliRunner().invoke(app, ["init", "--refresh-skills"])

    assert result.exit_code == 0, result.output
    local = repo / LOCAL_SKILLS_SUBDIR
    assert (local / "datum-go.js").is_file()
    cfg = json.loads((repo / ".datum" / "config.json").read_text())
    assert cfg["skills_dir"] == str(local.resolve())
    assert cfg["language"] == "python"  # existing values preserved
    # Refresh is a narrow operation: no epic bootstrap side effects.
    assert _branch(repo) == "main"
    assert not (repo / "docs").exists()
    assert not (repo / "CURRENT_STATE.md").exists()


def test_init_refresh_skills_overwrites_locally_modified_copy(tmp_path, monkeypatch):
    repo = tmp_path / "consumer"
    _git_repo(repo)
    monkeypatch.chdir(repo)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    local = repo / LOCAL_SKILLS_SUBDIR
    local.mkdir(parents=True)
    (local / "datum-go.js").write_text("// stale local copy\n")

    result = CliRunner().invoke(app, ["init", "--refresh-skills"])

    assert result.exit_code == 0, result.output
    assert (local / "datum-go.js").read_text() != "// stale local copy\n"
