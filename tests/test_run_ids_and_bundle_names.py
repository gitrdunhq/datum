"""Closeout follow-ups of run 20261012-150046, Python side.

SEC-001: every closeout collector joined --run-id into .datum/runs/<id>
unchecked; the runner now refuses such ids and so do the collectors, with the
same pattern. SEC-002/SEC-003: `datum workflow run <name>` joined the name
into a path unchecked, and a repo-local .datum/skills/<name>.js shadowed the
packaged bundle without a word. ARCH-005: the runtime kind list lived in two
hard-coded copies (TypeScript and Python); both now read one file.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app
from datum.run_ids import RUN_ID_RE, run_id_arg

ROOT = Path(__file__).resolve().parents[1]
COLLECTORS = sorted(
    p.stem
    for p in (ROOT / "datum" / "closeout").glob("*.py")
    if '"--run-id"' in p.read_text()
)


def test_the_python_and_typescript_patterns_are_the_same():
    # Catches: the two sides of the same id drifting apart.
    ts = (ROOT / "skills" / "src" / "runtime" / "metrics.ts").read_text()
    m = re.search(r"export const RUN_ID_RE = /(.+)/\n", ts)
    assert m, "RUN_ID_RE not found in metrics.ts"
    assert m.group(1) == RUN_ID_RE.pattern


@pytest.mark.parametrize(
    "good", ["20261012-150046", "20261012-150046-b2", "r1.retry_2"]
)
def test_plain_ids_pass(good):
    assert run_id_arg(good) == good


@pytest.mark.parametrize(
    "bad", ["../../x", "a/b", "/abs", "..", ".hidden", "a\\b", "x" * 129, "a b", ""]
)
def test_ids_that_are_not_one_plain_segment_fail(bad):
    import argparse

    with pytest.raises(argparse.ArgumentTypeError, match="run_id_invalid"):
        run_id_arg(bad)


def test_every_closeout_collector_is_covered():
    assert len(COLLECTORS) >= 15, COLLECTORS


@pytest.mark.parametrize("module", COLLECTORS)
def test_every_closeout_collector_refuses_a_traversal_run_id(module, tmp_path):
    # Catches: one collector still writing outside .datum/runs.
    r = subprocess.run(
        [sys.executable, "-m", f"datum.closeout.{module}", "--run-id", "../../escape"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        env={"PYTHONPATH": str(ROOT), "PATH": "/usr/bin:/bin"},
        check=False,
    )
    assert r.returncode == 2, (module, r.stdout, r.stderr)
    assert "run_id_invalid" in r.stderr
    assert not (tmp_path.parent / "escape").exists()


# --- workflow run <name> --------------------------------------------------

RUNTIME_OK = {"kind": "fake", "models": {"fast": "f", "balanced": "b", "deep": "d"}}


@pytest.fixture
def repo(tmp_path, monkeypatch):
    from datum import workflow_run

    pkg = tmp_path / "pkg-skills"
    local = tmp_path / ".datum" / "skills"
    pkg.mkdir()
    local.mkdir(parents=True)
    (tmp_path / ".datum" / "config.json").write_text(
        json.dumps({"skills_dir": str(pkg), "runtime": RUNTIME_OK})
    )
    (tmp_path / "a.json").write_text("{}")
    stub = tmp_path / "stub.js"
    stub.write_text("process.stdout.write('{}'); process.exit(0);\n")
    monkeypatch.setattr(workflow_run, "RUNNER_PATH", stub)
    monkeypatch.chdir(tmp_path)
    return {"pkg": pkg, "local": local, "root": tmp_path}


def _run(name: str):
    return CliRunner().invoke(app, ["workflow", "run", name, "--args", "a.json"])


@pytest.mark.parametrize("bad", ["../outside", "sub/dir", "..", "/abs", ".hidden"])
def test_a_bundle_name_with_a_path_in_it_is_a_usage_error(repo, bad):
    # Catches: a name walking out of the skills dirs to any .js file.
    (repo["root"] / "outside.js").write_text("return 1\n")
    r = _run(bad)
    assert r.exit_code == 2
    assert "workflow_name_invalid" in r.stderr


def test_a_local_bundle_shadowing_a_packaged_one_is_named(repo):
    # Catches: a cloned repo's .datum/skills/<name>.js silently replacing
    # the packaged bundle.
    (repo["pkg"] / "datum-go.js").write_text("return 1\n")
    (repo["local"] / "datum-go.js").write_text("return 2\n")
    r = _run("datum-go")
    assert r.exit_code == 0, r.stderr
    assert "workflow_bundle_shadowed: datum-go" in r.stderr
    assert str(repo["local"] / "datum-go.js") in r.stderr


def test_an_unshadowed_bundle_runs_without_a_warning(repo):
    (repo["pkg"] / "datum-go.js").write_text("return 1\n")
    r = _run("datum-go")
    assert r.exit_code == 0, r.stderr
    assert "shadowed" not in r.stderr


# --- runtime kinds: one source --------------------------------------------


def test_python_reads_the_runtime_kinds_from_the_shared_file():
    # Catches: a kind added on one side only.
    from datum import workflow_run

    shared = json.loads((ROOT / "assets" / "runtime-kinds.json").read_text())
    assert tuple(shared["kinds"]) == workflow_run.RUNTIME_KINDS
    assert tuple(shared["unavailable"]) == workflow_run.UNAVAILABLE_KINDS
    models_ts = (ROOT / "skills" / "src" / "shared" / "models.ts").read_text()
    assert "runtime-kinds.json" in models_ts
    assert "['fake', 'pi']" not in models_ts
