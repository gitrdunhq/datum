from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run_cmd(args: list[str], cwd: Path = ROOT) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


class DATUMHardeningTests(unittest.TestCase):
    def test_contract_fixtures_validate(self) -> None:
        result = run_cmd([sys.executable, "scripts/contracts.py", "self-test"])
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])

    def test_self_check_passes(self) -> None:
        result = run_cmd([sys.executable, "scripts/self_check.py"])
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertGreater(payload["documented_script_refs"], 0)

    def test_validate_profiles_gate_exists(self) -> None:
        result = run_cmd([sys.executable, "scripts/gate.py", "validate-profiles"])
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["passed"])

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
                        "tasks": {"completed": 1, "total": 1, "failed_terminal": 0, "say_do_ratio": 1},
                        "git": {"commit_count": 2, "files_touched": ["a.py"], "loc_net": 4},
                        "token_metrics": {"total": 10},
                        "brief_defects": [],
                        "lane_tools": {"lane_tools_added": []},
                        "solutions": [{"slug": "example"}],
                    }
                )
            )
            result = run_cmd(
                [
                    sys.executable,
                    "scripts/render.py",
                    "--closeout-data",
                    str(closeout),
                    "--output",
                    str(output),
                ]
            )
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            self.assertIn("DATUM Retro", output.read_text())

    def test_commit_queue_requires_clean_tree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self._init_repo(repo)
            (repo / "dirty.txt").write_text("untracked\n")
            patch = self._write_patch_outside_repo()

            try:
                result = run_cmd(
                    [
                        sys.executable,
                        str(ROOT / "scripts/commit_queue.py"),
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
            self.assertEqual((repo / "app.txt").read_text(), "hello\n")

    def test_commit_queue_applies_declared_patch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self._init_repo(repo)
            patch = self._write_patch_outside_repo()

            try:
                result = run_cmd(
                    [
                        sys.executable,
                        str(ROOT / "scripts/commit_queue.py"),
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

    def test_hard_stop_hooks_block_banned_patterns_and_source_only_act(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self._init_repo(repo)

            (repo / "bad.py").write_text("<<<<<<< HEAD\n")
            run_cmd(["git", "add", "bad.py"], cwd=repo)
            banned = run_cmd(
                ["bash", str(ROOT / "assets/hooks/pre-commit-banned-patterns.sh")],
                cwd=repo,
            )
            self.assertEqual(banned.returncode, 2, banned.stderr or banned.stdout)

        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            self._init_repo(repo)
            (repo / ".datum").mkdir()
            (repo / ".datum/state.json").write_text(json.dumps({"current_phase": "act"}))
            (repo / "feature.py").write_text("print('source only')\n")
            run_cmd(["git", "add", "feature.py"], cwd=repo)
            tdd_guard = run_cmd(
                ["bash", str(ROOT / "assets/hooks/pre-commit-tdd-guard.sh")],
                cwd=repo,
            )
            self.assertEqual(tdd_guard.returncode, 2, tdd_guard.stderr or tdd_guard.stdout)

    def _init_repo(self, repo: Path) -> None:
        run_cmd(["git", "init"], cwd=repo)
        run_cmd(["git", "config", "user.email", "test@example.com"], cwd=repo)
        run_cmd(["git", "config", "user.name", "Test User"], cwd=repo)
        (repo / "app.txt").write_text("hello\n")
        run_cmd(["git", "add", "app.txt"], cwd=repo)
        result = run_cmd(["git", "commit", "-m", "initial"], cwd=repo)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def _patch_for_app_txt(self) -> str:
        return """diff --git a/app.txt b/app.txt
index ce01362..94954ab 100644
--- a/app.txt
+++ b/app.txt
@@ -1 +1,2 @@
 hello
+world
"""

    def _write_patch_outside_repo(self) -> Path:
        handle = tempfile.NamedTemporaryFile("w", suffix=".patch", delete=False)
        with handle:
            handle.write(self._patch_for_app_txt())
        return Path(handle.name)


if __name__ == "__main__":
    unittest.main()
