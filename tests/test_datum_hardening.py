from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_module(
    module: str, args: list[str] | None = None, cwd: Path = ROOT
) -> subprocess.CompletedProcess:
    cmd = [sys.executable, str(ROOT / "scripts/datum.py"), module]
    if args:
        cmd.extend(args)
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def run_cmd(args: list[str], cwd: Path = ROOT) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


class TestPackageImports(unittest.TestCase):
    def test_datum_package_imports(self) -> None:
        result = run_cmd(
            [
                sys.executable,
                "-c",
                "from datum.state import load_state, PHASES; print(PHASES)",
            ]
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("act", result.stdout)

    def test_cli_entrypoint_help(self) -> None:
        result = run_module("--help")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DATUM V2", result.stdout)

    def test_cli_doctor_runs(self) -> None:
        result = run_module("doctor", ["--phase", "act", "--role", "general"])
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_no_mcp_imports(self) -> None:
        result = run_cmd([sys.executable, "-c", "import datum.cli; print('ok')"])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("mcp", result.stderr)

    def test_no_product_state_module(self) -> None:
        result = run_cmd([sys.executable, "-c", "import datum.product_state"])
        self.assertNotEqual(result.returncode, 0)


class TestContracts(unittest.TestCase):
    def test_contract_fixtures_validate(self) -> None:
        result = run_module("datum.contracts", ["self-test"])
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])


class TestGate(unittest.TestCase):
    def test_validate_profiles_gate(self) -> None:
        result = run_module("datum.gate", ["validate-profiles"])
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["passed"])


class TestRulesDoctor(unittest.TestCase):
    def test_preflight_runs(self) -> None:
        result = run_module(
            "datum.rules_doctor", ["preflight", "--phase", "act", "--role", "general"]
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


class TestRenderer(unittest.TestCase):
    def test_closeout_data_renderer(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            closeout = tmp_path / "closeout-data.json"
            output = tmp_path / "RETRO.md"
            closeout.write_text(
                json.dumps(
                    {
                        "run_id": "epic-1-20260101-120000",
                        "merge_sha": "abc123",
                        "tasks": {
                            "completed": 1,
                            "total": 1,
                            "failed_terminal": 0,
                            "say_do_ratio": 1,
                        },
                        "git": {
                            "commit_count": 2,
                            "files_touched": ["a.py"],
                            "loc_net": 4,
                        },
                        "token_metrics": {"total": 10},
                        "brief_defects": [],
                        "lane_tools": {"lane_tools_added": []},
                        "solutions": [{"slug": "example"}],
                    }
                )
            )
            result = run_module(
                "datum.render",
                ["--closeout-data", str(closeout), "--output", str(output)],
            )
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            self.assertIn("DATUM Retro", output.read_text())


class TestHooks(unittest.TestCase):
    def test_banned_patterns_blocks_conflict_markers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            _init_repo(repo)
            (repo / "bad.py").write_text("<<<<<<< HEAD\n")
            run_cmd(["git", "add", "bad.py"], cwd=repo)
            result = run_cmd(
                ["bash", str(ROOT / "assets/hooks/pre-commit-banned-patterns.sh")],
                cwd=repo,
            )
            self.assertEqual(result.returncode, 2, result.stderr or result.stdout)


class TestCommitQueue(unittest.TestCase):
    def test_requires_clean_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            _init_repo(repo)
            (repo / "dirty.txt").write_text("untracked\n")
            patch = _write_patch()
            try:
                result = run_module(
                    "datum.commit_queue",
                    [
                        "--run-id",
                        "epic-1-20260101-120000",
                        "--apply-patch",
                        str(patch),
                        "--message",
                        "green(task-001): update app",
                    ],
                    cwd=repo,
                )
            finally:
                patch.unlink(missing_ok=True)
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["error"], "dirty_working_tree")

    def test_applies_declared_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            _init_repo(repo)
            patch = _write_patch()
            try:
                result = run_module(
                    "datum.commit_queue",
                    [
                        "--run-id",
                        "epic-1-20260101-120000",
                        "--apply-patch",
                        str(patch),
                        "--message",
                        "green(task-001): update app",
                    ],
                    cwd=repo,
                )
            finally:
                patch.unlink(missing_ok=True)
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            payload = json.loads(result.stdout)
            self.assertTrue(payload["ok"])
            self.assertEqual((repo / "app.txt").read_text(), "hello\nworld\n")


class TestSkillAssets(unittest.TestCase):
    def test_skill_md_exists(self) -> None:
        self.assertTrue((ROOT / "SKILL.md").exists())

    def test_datum_md_exists(self) -> None:
        self.assertTrue((ROOT / "docs/DATUM.md").exists())

    def test_install_sh_exists_and_executable(self) -> None:
        install = ROOT / "install.sh"
        self.assertTrue(install.exists())
        import os

        self.assertTrue(os.access(install, os.X_OK))

    def test_all_phase_references_exist(self) -> None:
        required = [
            "00-discovery.md",
            "01-refine.md",
            "01.5-research.md",
            "02-plan.md",
            "03-properties.md",
            "03.5-architect.md",
            "04-act.md",
            "05-validate.md",
            "06-review.md",
            "07-pr-comments.md",
            "08-closeout.md",
        ]
        refs = ROOT / "references"
        for f in required:
            self.assertTrue((refs / f).exists(), f"Missing reference: {f}")

    def test_no_product_pipeline_references(self) -> None:
        refs = ROOT / "references"
        removed = [
            "p1-triage.md",
            "p2-discovery.md",
            "p2a-competitive.md",
            "p2b-stakeholder.md",
            "p2c-prior-art.md",
            "p3-requirements.md",
            "p4-handoff.md",
        ]
        for f in removed:
            self.assertFalse(
                (refs / f).exists(), f"Product pipeline ref should be removed: {f}"
            )

    def test_no_mcp_server(self) -> None:
        self.assertFalse((ROOT / "datum/mcp").exists())
        self.assertFalse((ROOT / "datum/mcp_server.py").exists())

    def test_schemas_present(self) -> None:
        schemas = ROOT / "assets/fixtures/contracts"
        self.assertTrue(schemas.exists())
        self.assertGreater(len(list(schemas.glob("*.json"))), 0)


def _init_repo(repo: Path) -> None:
    run_cmd(["git", "init"], cwd=repo)
    run_cmd(["git", "config", "user.email", "test@example.com"], cwd=repo)
    run_cmd(["git", "config", "user.name", "Test User"], cwd=repo)
    (repo / "app.txt").write_text("hello\n")
    run_cmd(["git", "add", "app.txt"], cwd=repo)
    run_cmd(["git", "commit", "-m", "initial"], cwd=repo)


def _write_patch() -> Path:
    handle = tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False)
    with handle:
        handle.write("""diff --git a/app.txt b/app.txt
index ce01362..94954ab 100644
--- a/app.txt
+++ b/app.txt
@@ -1 +1,2 @@
 hello
+world
""")
    return Path(handle.name)


if __name__ == "__main__":
    unittest.main()
