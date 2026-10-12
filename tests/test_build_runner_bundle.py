"""RED tests for DAT-18: build-workflows.sh also bundles the runner.

Traceability:
  AC3 -> test_ac3_build_produces_runner_js_with_generated_banner
  AC3 -> test_ac3_build_script_names_runner_in_verify_output
  AC4 -> test_ac4_runner_js_is_not_post_processed_like_a_workflow
  AC4 -> test_ac4_existing_bundles_are_byte_identical_after_build
  AC5 -> test_ac5_package_json_dependencies_unchanged
"""

import hashlib
import json
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "scripts" / "build-workflows.sh"
RUNNER_JS = REPO / "skills" / "runtime" / "runner.js"
BANNER = "// @generated — DO NOT EDIT. Source: skills/src/"
BUILD_TIMEOUT = 600


def _build(*extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(SCRIPT), *extra],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=BUILD_TIMEOUT,
    )


def _bundle_hashes() -> dict:
    return {
        p.name: hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((REPO / "skills").glob("datum-*.js"))
    }


BUNDLES_BEFORE = _bundle_hashes()


@pytest.fixture(scope="module")
def built() -> subprocess.CompletedProcess:
    if RUNNER_JS.exists():
        RUNNER_JS.unlink()
    return _build()


def _first_line(path: Path) -> str:
    with path.open(encoding="utf-8") as fh:
        return fh.readline().rstrip("\n")


def test_ac3_build_produces_runner_js_with_generated_banner(built):
    assert built.returncode == 0, built.stdout + built.stderr
    assert RUNNER_JS.is_file(), "skills/runtime/runner.js was not produced by the build"
    assert _first_line(RUNNER_JS).startswith(BANNER)


def test_ac3_build_script_names_runner_in_verify_output(built):
    assert "runner.js" in built.stdout


def test_ac4_runner_js_is_not_post_processed_like_a_workflow(built):
    assert RUNNER_JS.is_file()
    text = RUNNER_JS.read_text(encoding="utf-8")
    assert not text.startswith("export const meta")
    assert "\nexport const meta = " not in text


def test_ac4_existing_bundles_are_byte_identical_after_build(built):
    assert built.returncode == 0, built.stdout + built.stderr
    assert BUNDLES_BEFORE, "expected committed datum-*.js bundles"
    assert _bundle_hashes() == BUNDLES_BEFORE


def test_ac5_package_json_dependencies_unchanged(built):
    pkg = json.loads((REPO / "package.json").read_text(encoding="utf-8"))
    head = subprocess.run(
        ["git", "show", "HEAD:package.json"],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert head.returncode == 0, head.stderr
    committed = json.loads(head.stdout)
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        assert pkg.get(key) == committed.get(key)
