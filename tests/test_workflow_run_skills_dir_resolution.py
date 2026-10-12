"""Review iteration 2, CORR-002: `datum workflow run` finds the package's
bundles through datum.skills_materialize.resolve_skills_dir when
.datum/config.json names no skills_dir (SPEC R9.2). It read only the config
string, so a bundle shipped in the package skills dir was "workflow bundle
not found" (exit 2) in a repo whose config left skills_dir unset."""

from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

from datum import workflow_run
from datum.cli import app

RUNTIME_OK = {"kind": "fake", "models": {"fast": "f", "balanced": "b", "deep": "d"}}


def _setup(tmp_path, monkeypatch, cfg: dict) -> tuple[Path, Path]:
    (tmp_path / ".datum" / "skills").mkdir(parents=True)
    (tmp_path / "a.json").write_text("{}")
    (tmp_path / ".datum" / "config.json").write_text(json.dumps(cfg))
    record = tmp_path / "argv.json"
    stub = tmp_path / "stub.js"
    stub.write_text(
        "const fs=require('fs');fs.writeFileSync(%r, JSON.stringify(process.argv.slice(2)));process.stdout.write('{}')\n"
        % str(record)
    )
    monkeypatch.setattr(workflow_run, "RUNNER_PATH", stub)
    monkeypatch.chdir(tmp_path)
    return record, tmp_path


def test_without_skills_dir_in_config_the_resolved_package_dir_is_searched(tmp_path, monkeypatch):
    # Catches: the config-only lookup reporting a package bundle as not found.
    pkg = tmp_path / "pkg-skills"
    pkg.mkdir()
    (pkg / "fixture.js").write_text("return 2\n")
    seen: list[Path] = []

    def fake_resolve(repo_root, package_skills_dir, **kw):
        seen.append(Path(repo_root))
        return pkg

    monkeypatch.setattr("datum.skills_materialize.resolve_skills_dir", fake_resolve)
    record, root = _setup(tmp_path, monkeypatch, {"runtime": RUNTIME_OK})
    result = CliRunner().invoke(app, ["workflow", "run", "fixture", "--args", "a.json"])
    assert result.exit_code == 0, result.output
    argv = json.loads(record.read_text())
    bundle = argv[argv.index("--bundle") + 1]
    assert Path(bundle).resolve() == (pkg / "fixture.js").resolve()
    assert str(pkg) in [argv[i + 1] for i, a in enumerate(argv) if a == "--skills-dir"]
    assert seen and seen[0].resolve() == root.resolve()


def test_a_skills_dir_in_config_still_wins_and_resolve_is_not_called(tmp_path, monkeypatch):
    # Catches: the resolver overriding an explicit configuration.
    cfg_dir = tmp_path / "cfg-skills"
    cfg_dir.mkdir()
    (cfg_dir / "fixture.js").write_text("return 3\n")

    def boom(*a, **k):
        raise AssertionError("resolve_skills_dir must not run when config names skills_dir")

    monkeypatch.setattr("datum.skills_materialize.resolve_skills_dir", boom)
    record, _ = _setup(tmp_path, monkeypatch, {"runtime": RUNTIME_OK, "skills_dir": str(cfg_dir)})
    result = CliRunner().invoke(app, ["workflow", "run", "fixture", "--args", "a.json"])
    assert result.exit_code == 0, result.output
    argv = json.loads(record.read_text())
    assert Path(argv[argv.index("--bundle") + 1]).resolve() == (cfg_dir / "fixture.js").resolve()
