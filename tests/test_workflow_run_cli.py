"""RED tests for DAT-19: ``datum workflow run <name>`` command.

The command resolves a workflow bundle, validates the args file and the
``runtime`` block of the config, then spawns the host-side runner
(``node <RUNNER_PATH> --bundle --args --config --repo-root --skills-dir``).
These tests point ``datum.workflow_run.RUNNER_PATH`` at a tiny node stub, so
no built ``skills/runtime/runner.js`` is needed.
"""

from __future__ import annotations

import inspect
import json
import os
import subprocess
import tomllib
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app

ROOT = Path(__file__).resolve().parents[1]

RUNTIME_OK = {"kind": "fake", "models": {"fast": "f", "balanced": "b", "deep": "d"}}


def _write_stub(path: Path, record: Path, *, stdout: str = "", stderr: str = "", code: int = 0) -> None:
    """A node stub standing in for runner.js: records its argv, then replays."""
    path.write_text(
        "const fs = require('fs');\n"
        f"fs.appendFileSync({json.dumps(str(record))}, JSON.stringify(process.argv.slice(2)) + '\\n');\n"
        f"process.stdout.write({json.dumps(stdout)});\n"
        f"process.stderr.write({json.dumps(stderr)});\n"
        f"process.exit({code});\n"
    )


class Repo:
    def __init__(self, root: Path):
        self.root = root
        self.record = root / "stub-argv.jsonl"
        self.stub = root / "stub-runner.js"
        self.pkg_skills = root / "pkg-skills"
        self.local_skills = root / ".datum" / "skills"
        self.args_file = root / "a.json"

    def calls(self) -> list[list[str]]:
        if not self.record.exists():
            return []
        return [json.loads(line) for line in self.record.read_text().splitlines() if line]

    def flag(self, call: list[str], name: str) -> str:
        return call[call.index(name) + 1]


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """tmp repo: .datum/config.json (valid fake runtime), a.json, local bundle, stub runner."""
    from datum import workflow_run

    r = Repo(tmp_path)
    (tmp_path / ".datum").mkdir()
    r.local_skills.mkdir()
    r.pkg_skills.mkdir()
    (r.local_skills / "fixture.js").write_text("return 1\n")
    r.args_file.write_text('{"x": 1}')
    _write_config(r, {"skills_dir": str(r.pkg_skills), "runtime": RUNTIME_OK})
    _write_stub(r.stub, r.record, stdout='{"r":1}')
    monkeypatch.setattr(workflow_run, "RUNNER_PATH", r.stub)
    monkeypatch.chdir(tmp_path)
    return r


def _write_config(r: Repo, cfg: dict, name: str = "config.json") -> Path:
    p = r.root / ".datum" / name
    p.write_text(json.dumps(cfg))
    return p


def _run(*extra: str, name: str = "fixture", args: str | None = "a.json"):
    argv = ["workflow", "run", name]
    if args is not None:
        argv += ["--args", args]
    return CliRunner().invoke(app, [*argv, *extra])


# --- AC1 ---------------------------------------------------------------


def test_ac1_stub_runner_json_result_is_printed_and_exit_0(repo):
    result = _run()
    assert result.exit_code == 0, result.stderr
    assert json.loads(result.stdout) == {"r": 1}
    assert len(repo.calls()) == 1


def test_ac1_runner_receives_the_documented_argv_contract(repo):
    result = _run()
    assert result.exit_code == 0, result.stderr
    (call,) = repo.calls()
    assert {"--bundle", "--args", "--config", "--repo-root", "--skills-dir"} <= set(call)
    assert Path(repo.flag(call, "--bundle")).resolve() == (repo.local_skills / "fixture.js").resolve()
    assert Path(repo.flag(call, "--args")).resolve() == repo.args_file.resolve()
    assert Path(repo.flag(call, "--config")).resolve() == (repo.root / ".datum" / "config.json").resolve()
    assert Path(repo.flag(call, "--repo-root")).resolve() == repo.root.resolve()


def test_ac1_config_option_overrides_the_default_config(repo):
    _write_config(repo, {"skills_dir": str(repo.pkg_skills)})  # default has no runtime
    other = _write_config(repo, {"skills_dir": str(repo.pkg_skills), "runtime": RUNTIME_OK}, "other.json")
    result = _run("--config", str(other))
    assert result.exit_code == 0, result.stderr
    (call,) = repo.calls()
    assert Path(repo.flag(call, "--config")).resolve() == other.resolve()


# --- AC2 ---------------------------------------------------------------


def test_ac2_runner_exit_1_passes_stderr_through_and_exits_1(repo):
    _write_stub(repo.stub, repo.record, stderr="boom", code=1)
    result = _run()
    assert result.exit_code == 1
    assert "boom" in result.stderr
    assert result.stdout.strip() == ""


# --- AC3: one test per exit-2 cause --------------------------------------


def _assert_usage_error(repo, result, *needles: str) -> None:
    assert result.exit_code == 2, (result.stdout, result.stderr)
    for needle in needles:
        assert needle in result.stderr, result.stderr
    assert repo.calls() == [], "runner must not be spawned on a usage error"


def test_ac3_bundle_found_in_neither_directory_exits_2(repo):
    result = _run(name="nosuchbundle")
    _assert_usage_error(repo, result, "nosuchbundle")


def test_ac3_missing_args_file_exits_2(repo):
    result = _run(args="missing.json")
    _assert_usage_error(repo, result, "missing.json")


def test_ac3_args_file_not_json_exits_2(repo):
    repo.args_file.write_text("this is { not json")
    result = _run()
    _assert_usage_error(repo, result, "a.json")


def test_ac3_config_without_runtime_block_exits_2(repo):
    _write_config(repo, {"skills_dir": str(repo.pkg_skills)})
    result = _run()
    _assert_usage_error(repo, result, "runtime")


def test_ac3_unknown_runtime_kind_exits_2_with_named_message(repo):
    _write_config(repo, {"skills_dir": str(repo.pkg_skills), "runtime": {**RUNTIME_OK, "kind": "bogus"}})
    result = _run()
    _assert_usage_error(repo, result, "runtime_kind_unknown: bogus")


def test_ac3_runtime_kind_pi_without_stage_script_exits_2(repo):
    _write_config(repo, {"skills_dir": str(repo.pkg_skills), "runtime": {**RUNTIME_OK, "kind": "pi"}})
    result = _run()
    _assert_usage_error(repo, result, "runtime_stage_script_missing")


# --- AC4 ---------------------------------------------------------------


def test_ac4_runner_spawned_with_list_argv_no_shell_and_explicit_timeout(repo, monkeypatch):
    seen: list[tuple[object, dict]] = []
    real_run = subprocess.run

    def spy(*a, **kw):
        seen.append((a[0] if a else kw.get("args"), kw))
        return real_run(*a, **kw)

    def no_system(*_a, **_kw):
        raise AssertionError("os.system must not be used")

    monkeypatch.setattr(subprocess, "run", spy)
    monkeypatch.setattr(os, "system", no_system)

    result = _run()
    assert result.exit_code == 0, result.stderr
    spawns = [(argv, kw) for argv, kw in seen if isinstance(argv, (list, tuple)) and str(repo.stub) in map(str, argv)]
    assert len(spawns) == 1, f"expected exactly one runner spawn, saw {seen}"
    argv, kw = spawns[0]
    assert Path(str(argv[0])).name == "node"
    assert not kw.get("shell"), "shell=True is banned"
    timeout = kw.get("timeout")
    assert isinstance(timeout, (int, float)) and not isinstance(timeout, bool) and timeout > 0


# --- AC5 ---------------------------------------------------------------


def test_ac5_local_bundle_is_preferred_over_skills_dir(repo):
    (repo.pkg_skills / "fixture.js").write_text("return 2\n")
    result = _run()
    assert result.exit_code == 0, result.stderr
    (call,) = repo.calls()
    assert Path(repo.flag(call, "--bundle")).resolve() == (repo.local_skills / "fixture.js").resolve()


def test_ac5_falls_back_to_skills_dir_when_no_local_bundle(repo):
    (repo.local_skills / "fixture.js").unlink()
    (repo.pkg_skills / "fixture.js").write_text("return 2\n")
    result = _run()
    assert result.exit_code == 0, result.stderr
    (call,) = repo.calls()
    assert Path(repo.flag(call, "--bundle")).resolve() == (repo.pkg_skills / "fixture.js").resolve()


# --- AC6 ---------------------------------------------------------------


def _workflow_run_callback():
    def group_name(g):
        return g.name if isinstance(g.name, str) else g.typer_instance.info.name

    group = next(g for g in app.registered_groups if group_name(g) == "workflow")
    cmd = next(
        c
        for c in group.typer_instance.registered_commands
        if (c.name or c.callback.__name__) == "run"
    )
    return cmd.callback


def test_ac6_cli_wrapper_is_under_15_lines_and_flag_contract_test_untouched():
    callback = _workflow_run_callback()
    assert len(inspect.getsource(callback).splitlines()) < 15
    diff = subprocess.run(
        ["git", "diff", "--name-only", "HEAD", "--", "tests/test_cli_flag_contract.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert diff.returncode == 0
    assert diff.stdout.strip() == ""


# --- AC7 ---------------------------------------------------------------


def test_ac7_pyproject_dependencies_unchanged_by_the_workflow_command(repo):
    assert _run().exit_code == 0
    head = subprocess.run(
        ["git", "show", "HEAD:pyproject.toml"], cwd=ROOT, capture_output=True, text=True, timeout=30
    )
    assert head.returncode == 0, head.stderr
    before = tomllib.loads(head.stdout)
    after = tomllib.loads((ROOT / "pyproject.toml").read_text())
    assert after["project"]["dependencies"] == before["project"]["dependencies"]
    assert after["project"].get("optional-dependencies") == before["project"].get("optional-dependencies")
