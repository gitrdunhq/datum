"""Tests for skeleton_creator impl-stub placement (#388).

`datum skeleton` must never leave implementation stub files as untracked
source files in the checkout it runs in. Stubs belong ONLY in the
preflight JSON artifact (as `impl_stubs[*].content`) — GREEN reads the
content from there and writes the real file itself. Writing a stub to
disk left stray untracked files (e.g. src/caliper/core/part_score.py)
that collided with squash-merge and could shadow GREEN's implementation
with a NotImplementedError during RED.
"""

import json
import subprocess

from datum.skeleton_creator import build_impl_stubs, run_preflight


def _git_status_porcelain(repo: object) -> str:
    return subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout


def _init_repo(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "t@example.com"], cwd=tmp_path, check=True
    )
    subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp_path, check=True)
    return tmp_path


class TestBuildImplStubsNeverWritesDisk:
    def test_no_stub_file_written_for_missing_impl_file(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        impl_path = tmp_path / "src" / "caliper" / "core" / "part_score.py"

        stubs = build_impl_stubs(
            task_id="task-001",
            acs=["compute_part_score(part, weights) returns a float"],
            impl_files=[str(impl_path)],
            language="python",
        )

        assert not impl_path.exists(), "impl stub must not be written to disk"
        assert stubs, "expected a stub entry to still be produced"
        assert stubs[0]["path"] == str(impl_path)
        assert stubs[0]["stub_written"] is False
        assert "compute_part_score" in stubs[0]["content"]


class TestSkeletonPreflightRootCheckoutClean:
    def test_root_checkout_has_no_untracked_source_after_preflight(
        self, tmp_path, monkeypatch
    ):
        repo = _init_repo(tmp_path)
        monkeypatch.chdir(repo)

        tasks = [
            {
                "id": "task-001",
                "slug": "part-score",
                "acceptance_criteria": [
                    "compute_part_score(part, weights) returns a float"
                ],
                "files": [
                    "src/caliper/core/part_score.py",
                    "tests/test_part_score.py",
                ],
            }
        ]
        tasks_path = repo / "tasks.json"
        tasks_path.write_text(json.dumps(tasks))

        output_path = repo / ".datum" / "runs" / "run1" / "preflight-task-001.json"

        result = run_preflight(
            task_id="task-001",
            language="python",
            tasks_path=tasks_path,
            output_path=output_path,
            skip_file_writes=True,
        )

        # No untracked file under src/ — the impl stub must never land as a
        # real source file in the checkout that ran `datum skeleton`.
        status = _git_status_porcelain(repo)
        assert "src/" not in status, f"stray untracked source file(s):\n{status}"

        impl_path = repo / "src" / "caliper" / "core" / "part_score.py"
        assert not impl_path.exists()

        # The skeleton artifact must still carry the stub content for GREEN.
        assert output_path.exists()
        artifact = json.loads(output_path.read_text())
        stubs = artifact["impl_stubs"]
        assert stubs, "expected impl_stubs to be present in the artifact"
        assert stubs[0]["path"] == "src/caliper/core/part_score.py"
        assert "compute_part_score" in stubs[0]["content"]
        assert result["impl_stubs"] == stubs
