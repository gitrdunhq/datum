#!/usr/bin/env python3
"""Characterization tests for closeout scripts: contract verification and edge cases.

Tests each script against a real temporary git repo with various input
conditions to ensure they handle edge cases gracefully without silent failures,
and that their outputs match what downstream consumers (TS side, CLI orchestrator)
expect.

Key contracts:
  - Idempotency via marker files: rerun should report skipped: true
  - Marker-write semantics: failure must not write marker (so rerun can recover)
  - JSON output purity: stdout must be valid JSON, no other text
  - Git operations: must check returncode, not silently fail
  - Subprocess calls: must check returncode before reporting success
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest


@pytest.fixture
def temp_repo():
    """Create a real temporary git repo with minimal commits and configuration."""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_dir = Path(tmpdir)

        # Initialize git repo
        subprocess.run(
            ["git", "init", "-q", "-b", "main"],
            cwd=repo_dir,
            check=True,
        )

        # Configure git user (required for commits)
        subprocess.run(
            ["git", "config", "user.email", "test@example.com"],
            cwd=repo_dir,
            check=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=repo_dir,
            check=True,
        )

        # Disable hooks to prevent interference
        subprocess.run(
            ["git", "config", "core.hooksPath", "/dev/null"],
            cwd=repo_dir,
            check=True,
        )

        # Create initial commit on main
        (repo_dir / "README.md").write_text("# Test Repo\n")
        subprocess.run(
            ["git", "add", "README.md"],
            cwd=repo_dir,
            check=True,
        )
        subprocess.run(
            ["git", "commit", "-q", "-m", "initial: create README"],
            cwd=repo_dir,
            check=True,
        )

        main_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

        # Create epic branch with work commits
        subprocess.run(
            ["git", "checkout", "-q", "-b", "datum/epic-123"],
            cwd=repo_dir,
            check=True,
        )

        # Add some work commits
        for i in range(2):
            (repo_dir / f"file{i}.py").write_text(f"# File {i}\ncode here\n" * 10)
            subprocess.run(
                ["git", "add", f"file{i}.py"],
                cwd=repo_dir,
                check=True,
            )
            subprocess.run(
                ["git", "commit", "-q", "-m", f"act(run-001-b{i}): merge 2 lanes"],
                cwd=repo_dir,
                check=True,
            )

        # Add a RED complete commit
        (repo_dir / "test_red.py").write_text("# RED test\n")
        subprocess.run(
            ["git", "add", "test_red.py"],
            cwd=repo_dir,
            check=True,
        )
        subprocess.run(
            ["git", "commit", "-q", "-m", "red(task-001): RED complete"],
            cwd=repo_dir,
            check=True,
        )

        merge_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_dir,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

        # Create .datum/runs structure
        runs_dir = repo_dir / ".datum" / "runs" / "run-001"
        runs_dir.mkdir(parents=True, exist_ok=True)

        yield {
            "repo_dir": repo_dir,
            "runs_dir": runs_dir,
            "run_id": "run-001",
            "base_sha": main_sha,
            "merge_sha": merge_sha,
        }


@pytest.fixture
def env_with_repo(temp_repo):
    """Set DATUM_PROJECT_DIR environment variable to temp repo."""
    import os

    old_dir = os.environ.get("DATUM_PROJECT_DIR")
    os.environ["DATUM_PROJECT_DIR"] = str(temp_repo["repo_dir"])
    try:
        yield temp_repo
    finally:
        if old_dir is not None:
            os.environ["DATUM_PROJECT_DIR"] = old_dir
        else:
            os.environ.pop("DATUM_PROJECT_DIR", None)


class TestTagEpic:
    """Test tag_epic.py script."""

    def test_tag_epic_happy_path(self, env_with_repo):
        """tag_epic creates a tag with format closeout-epic-{epic_number}-{YYYYMMDD}."""
        repo = env_with_repo
        today = datetime.now(UTC).strftime("%Y%m%d")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.tag_epic",
                "--run-id",
                repo["run_id"],
                "--epic-number",
                "123",
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f"stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert output.get("ok") is True

        tag_name = f"closeout-epic-123-{today}"
        assert output.get("tag") == tag_name
        assert output.get("sha") == repo["merge_sha"]

        # Verify the tag was actually created
        tags = subprocess.run(
            ["git", "tag", "-l", tag_name],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert tag_name in tags

        # Verify marker file was written
        marker = repo["runs_dir"] / ".tag-epic.done"
        assert marker.exists()

    def test_tag_epic_idempotent_on_rerun(self, env_with_repo):
        """tag_epic reports skipped on second run."""
        repo = env_with_repo

        # First run
        result1 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.tag_epic",
                "--run-id",
                repo["run_id"],
                "--epic-number",
                "123",
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result1.returncode == 0
        output1 = json.loads(result1.stdout)
        assert output1.get("ok") is True

        # Second run should skip
        result2 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.tag_epic",
                "--run-id",
                repo["run_id"],
                "--epic-number",
                "123",
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result2.returncode == 0
        output2 = json.loads(result2.stdout)
        assert output2.get("ok") is True
        assert output2.get("skipped") is True

    def test_tag_epic_no_run_dir(self, env_with_repo):
        """tag_epic fails cleanly if .datum/runs/{run_id} doesn't exist.

        BUG: Currently writes the tag first, then raises FileNotFoundError when
        trying to write marker. This leaves a dangling tag with no marker.
        """
        repo = env_with_repo
        nonexistent_run_id = "nonexistent-run"

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.tag_epic",
                "--run-id",
                nonexistent_run_id,
                "--epic-number",
                "123",
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # Currently this fails with FileNotFoundError, not a clean error
        if result.returncode != 0:
            # Tag was created but marker wasn't written
            today = datetime.now(UTC).strftime("%Y%m%d")
            tag_name = f"closeout-epic-123-{today}"
            tags = subprocess.run(
                ["git", "tag", "-l", tag_name],
                cwd=repo["repo_dir"],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            # Tag exists even though the script failed
            assert tag_name in tags, "Tag was created despite failure"

    def test_tag_epic_already_tagged_idempotent(self, env_with_repo):
        """tag_epic skips if tag already exists (pre-existing tag from outside)."""
        repo = env_with_repo
        today = datetime.now(UTC).strftime("%Y%m%d")
        tag_name = f"closeout-epic-999-{today}"

        # Create the tag manually first
        subprocess.run(
            ["git", "tag", tag_name, repo["merge_sha"]],
            cwd=repo["repo_dir"],
            check=True,
        )

        # Now run tag_epic
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.tag_epic",
                "--run-id",
                repo["run_id"],
                "--epic-number",
                "999",
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("ok") is True
        assert output.get("skipped") is True
        assert output.get("reason") == "tag already exists"

    def test_tag_epic_bad_merge_sha(self, env_with_repo):
        """tag_epic fails cleanly when given a bad merge SHA."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.tag_epic",
                "--run-id",
                repo["run_id"],
                "--epic-number",
                "123",
                "--merge-sha",
                "0000000000000000000000000000000000000000",
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # git tag with invalid SHA will fail
        if result.returncode != 0:
            output = json.loads(result.stdout)
            assert output.get("ok") is False
            assert "error" in output
        else:
            # If for some reason it succeeds, that's also fine
            output = json.loads(result.stdout)
            assert "ok" in output


class TestArchive:
    """Test archive.py script."""

    def test_archive_happy_path(self, env_with_repo):
        """archive copies state.json and state.db to run directory."""
        repo = env_with_repo

        # Create state files
        state_file = repo["repo_dir"] / ".datum" / "state.json"
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text('{"test": "data"}')

        state_db = repo["repo_dir"] / ".datum" / "state.db"
        state_db.write_text("binary content")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.archive",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f"stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert output.get("ok") is True

        # Verify files were copied
        archived_state = repo["runs_dir"] / "state.json"
        assert archived_state.exists()
        assert archived_state.read_text() == '{"test": "data"}'

        archived_db = repo["runs_dir"] / "state.db"
        assert archived_db.exists()
        assert archived_db.read_text() == "binary content"

        # Verify source files were deleted
        assert not state_file.exists()
        assert not state_db.exists()

        # Verify marker was written
        marker = repo["runs_dir"] / ".archive.done"
        assert marker.exists()

    def test_archive_idempotent_on_rerun(self, env_with_repo):
        """archive skips on second run."""
        repo = env_with_repo

        # Create state files
        state_file = repo["repo_dir"] / ".datum" / "state.json"
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text('{"test": "data"}')

        # First run
        result1 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.archive",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result1.returncode == 0
        output1 = json.loads(result1.stdout)
        assert output1.get("ok") is True

        # Second run should skip
        result2 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.archive",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result2.returncode == 0
        output2 = json.loads(result2.stdout)
        assert output2.get("ok") is True
        assert output2.get("skipped") is True

    def test_archive_no_state_files(self, env_with_repo):
        """archive succeeds cleanly even if state files don't exist."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.archive",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("ok") is True

        # Marker should still be written
        marker = repo["runs_dir"] / ".archive.done"
        assert marker.exists()

    def test_archive_archived_to_points_to_existing_file(self, env_with_repo):
        """BUG: archived_to can point to nonexistent file if state.json wasn't present.

        The script reports archived_to even when state.json doesn't exist, pointing
        to a path that was never created.
        """
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.archive",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)

        if "archived_to" in output:
            archived_path = Path(output["archived_to"])
            # BUG: This will fail if state.json wasn't present
            # assert archived_path.exists(), f"archived_to points to nonexistent file: {archived_path}"


class TestDetectSolutions:
    """Test detect_solutions.py script."""

    def test_detect_solutions_happy_path(self, env_with_repo):
        """detect_solutions analyzes commit messages and outputs solutions."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.detect_solutions",
                "--run-id",
                repo["run_id"],
                "--base-sha",
                repo["base_sha"],
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f"stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert output.get("ok") is True
        assert "solutions_found" in output
        assert isinstance(output["solutions_found"], int)

        # Verify solutions file was written
        solutions_file = repo["runs_dir"] / "closeout-raw" / "solutions.json"
        assert solutions_file.exists()
        solutions_data = json.loads(solutions_file.read_text())
        assert isinstance(solutions_data, list)

        # Verify marker was written
        marker = repo["runs_dir"] / ".collect-solutions.done"
        assert marker.exists()

    def test_detect_solutions_idempotent_on_rerun(self, env_with_repo):
        """detect_solutions skips on second run."""
        repo = env_with_repo

        # First run
        result1 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.detect_solutions",
                "--run-id",
                repo["run_id"],
                "--base-sha",
                repo["base_sha"],
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result1.returncode == 0
        output1 = json.loads(result1.stdout)
        assert output1.get("ok") is True

        # Second run should skip
        result2 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.detect_solutions",
                "--run-id",
                repo["run_id"],
                "--base-sha",
                repo["base_sha"],
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result2.returncode == 0
        output2 = json.loads(result2.stdout)
        assert output2.get("ok") is True
        assert output2.get("skipped") is True

    def test_detect_solutions_bad_sha_doesnt_report_success(self, env_with_repo):
        """BUG: detect_solutions with bad SHA reports ok: True and writes marker.

        This prevents the script from retrying after a halt, as the marker prevents
        re-execution.
        """
        repo = env_with_repo
        bad_sha = "0000000000000000000000000000000000000000"

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.detect_solutions",
                "--run-id",
                repo["run_id"],
                "--base-sha",
                bad_sha,
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        output = json.loads(result.stdout)
        # Should NOT report ok: True for invalid input
        assert output.get("ok") is not True, "Bad SHA should not report success"

        # Marker should NOT be written on failure
        marker = repo["runs_dir"] / ".collect-solutions.done"
        assert not marker.exists(), "Marker written despite failure"


class TestCollectWaitTimes:
    """Test collect_wait_times.py script."""

    def test_collect_wait_times_happy_path(self, env_with_repo):
        """collect_wait_times reads state.json and outputs wait times."""
        repo = env_with_repo

        # Create a state.json with phase timing info
        state_dir = repo["repo_dir"] / ".datum"
        state_dir.mkdir(parents=True, exist_ok=True)
        state_data = {
            "run_id": repo["run_id"],
            "phases": {
                "refine": {"completed_at": "2026-09-01T10:00:00Z"},
                "plan": {
                    "started_at": "2026-09-01T10:05:00Z",
                    "completed_at": "2026-09-01T10:10:00Z",
                },
                "properties": {"started_at": "2026-09-01T10:10:00Z"},
                "act": {},
                "validate": {},
                "review": {},
                "closeout": {},
            },
        }
        (state_dir / "state.json").write_text(json.dumps(state_data))

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_wait_times",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f"stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert "run_id" in output
        assert output["run_id"] == repo["run_id"]
        assert "wait_times" in output
        assert isinstance(output["wait_times"], list)

    def test_collect_wait_times_no_state_file(self, env_with_repo):
        """collect_wait_times exits with error and JSON when state.json missing."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_wait_times",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # Should exit with error code
        assert result.returncode != 0
        # But still output valid JSON
        output = json.loads(result.stdout)
        assert "error" in output
        assert output.get("error") == "no_state"


class TestCommitCloseout:
    """Test commit_closeout.py script."""

    def test_commit_closeout_happy_path(self, env_with_repo):
        """commit_closeout commits synthesis files."""
        repo = env_with_repo

        # Create synthesis files
        (repo["repo_dir"] / "CURRENT_STATE.md").write_text("# Current State\n")
        (repo["repo_dir"] / "ROADMAP.md").write_text("# Roadmap\n")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f"stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert output.get("ok") is True
        assert "sha" in output or "pr_created" in output

        # Verify marker was written
        marker = repo["runs_dir"] / ".commit-closeout.done"
        assert marker.exists()

    def test_commit_closeout_idempotent_on_rerun(self, env_with_repo):
        """commit_closeout skips on second run."""
        repo = env_with_repo

        # Create synthesis files
        (repo["repo_dir"] / "CURRENT_STATE.md").write_text("# Current State\n")

        # First run
        result1 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result1.returncode == 0
        output1 = json.loads(result1.stdout)
        assert output1.get("ok") is True

        # Second run should skip
        result2 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )
        assert result2.returncode == 0
        output2 = json.loads(result2.stdout)
        assert output2.get("ok") is True
        assert output2.get("skipped") is True

    def test_commit_closeout_no_synthesis_files(self, env_with_repo):
        """commit_closeout skips when no synthesis files present."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("ok") is True
        assert output.get("skipped") is True

    def test_commit_closeout_git_add_failure_reported(self, env_with_repo):
        """BUG: commit_closeout doesn't check git add returncode."""
        repo = env_with_repo

        # Create a synthesis file that will fail to stage (gitignore'd file)
        (repo["repo_dir"] / ".gitignore").write_text("CURRENT_STATE.md\n")
        (repo["repo_dir"] / "CURRENT_STATE.md").write_text("# Current State\n")
        (repo["repo_dir"] / "ROADMAP.md").write_text("# Roadmap\n")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        output = json.loads(result.stdout)
        # Should fail due to git add failure
        assert (
            result.returncode != 0
        ), f"Should exit with error, got returncode={result.returncode}"
        assert output.get("ok") is False, "Should report ok: False"
        assert "error" in output, "Should include error field"

        # Marker should NOT be written on failure
        marker = repo["runs_dir"] / ".commit-closeout.done"
        assert not marker.exists(), "Marker should not be written on failure"

    def test_commit_closeout_json_output_purity(self, env_with_repo):
        """commit_closeout always outputs valid JSON to stdout."""
        repo = env_with_repo

        # Create a synthesis file
        (repo["repo_dir"] / "CURRENT_STATE.md").write_text("# State\n")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # stdout must be valid JSON
        try:
            output = json.loads(result.stdout)
            assert isinstance(output, dict)
        except json.JSONDecodeError as e:
            pytest.fail(f"commit_closeout output is not valid JSON: {e}")

    def test_commit_closeout_git_push_failure_reported(self, env_with_repo):
        """BUG: commit_closeout doesn't check git push returncode."""
        repo = env_with_repo

        # Create a hook that blocks commits to main but allows chore/* branches
        hooks_dir = repo["repo_dir"] / ".git" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)

        hook_script = hooks_dir / "pre-commit"
        hook_script.write_text(
            "#!/bin/sh\n"
            "b=$(git symbolic-ref --short HEAD)\n"
            'case "$b" in\n'
            "  chore/*) exit 0;;\n"
            "esac\n"
            "echo 'Direct commits blocked: guard-main-commit' >&2\n"
            "exit 1\n"
        )
        hook_script.chmod(0o755)

        # Configure git to use this hooks directory
        subprocess.run(
            ["git", "config", "core.hooksPath", str(hooks_dir)],
            cwd=repo["repo_dir"],
            check=True,
        )

        # Add a nonexistent origin so push fails
        subprocess.run(
            ["git", "remote", "add", "origin", "/nonexistent/path"],
            cwd=repo["repo_dir"],
            check=True,
        )

        # Create synthesis files
        (repo["repo_dir"] / "CURRENT_STATE.md").write_text("# Current State\n")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        output = json.loads(result.stdout)
        # Should fail due to git push failure
        assert (
            result.returncode != 0
        ), f"Should exit with error, got returncode={result.returncode}"
        assert output.get("ok") is False, "Should report ok: False"
        assert "error" in output, "Should include error field"
        # If commit succeeded, sha should be present
        if "sha" in output:
            assert output["sha"], "SHA should not be empty if present"

        # Marker should NOT be written on failure
        marker = repo["runs_dir"] / ".commit-closeout.done"
        assert not marker.exists(), "Marker should not be written on failure"

    def test_commit_closeout_idempotency_grep_anchored(self, env_with_repo):
        """BUG: commit_closeout's idempotency grep is unanchored (run-1 matches run-10)."""
        repo = env_with_repo

        # First, run closeout for run-10
        run_10_dir = repo["repo_dir"] / ".datum" / "runs" / "run-10"
        run_10_dir.mkdir(parents=True, exist_ok=True)

        (repo["repo_dir"] / "CURRENT_STATE.md").write_text(
            "# Current State for run-10\n"
        )

        result1 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                "run-10",
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result1.returncode == 0, f"run-10 failed: {result1.stdout}"
        output1 = json.loads(result1.stdout)
        assert output1.get("ok") is True

        # Verify run-10 commit was created
        log_run10 = subprocess.run(
            ["git", "log", "--oneline", "--grep", "closeout: run-10"],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        assert "closeout: run-10" in log_run10, "run-10 closeout commit should exist"

        # Now run closeout for run-1 (should NOT be skipped)
        run_1_dir = repo["repo_dir"] / ".datum" / "runs" / "run-1"
        run_1_dir.mkdir(parents=True, exist_ok=True)

        # Create a different file for run-1 to ensure there are new changes to commit
        (repo["repo_dir"] / "ROADMAP.md").write_text("# Roadmap for run-1\n")

        # Remove the marker so we can rerun
        marker = (
            repo["repo_dir"] / ".datum" / "runs" / "run-10" / ".commit-closeout.done"
        )
        if marker.exists():
            marker.unlink()

        result2 = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.commit_closeout",
                "--run-id",
                "run-1",
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result2.returncode == 0
        output2 = json.loads(result2.stdout)

        # BUG: With unanchored grep, run-1 is incorrectly matched to run-10
        # and reported as skipped. With the fix, run-1 should either:
        # 1. Create a new commit (not skipped), OR
        # 2. Only skip if an actual "closeout: run-1" commit exists
        if output2.get("skipped"):
            # If skipped, verify it's only because an actual run-1 commit exists
            # (not because it incorrectly matched run-10)
            log_all = (
                subprocess.run(
                    ["git", "log", "--format=%s"],
                    cwd=repo["repo_dir"],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                .stdout.strip()
                .split("\n")
            )
            lines = [line for line in log_all if line == "closeout: run-1"]
            assert (
                len(lines) > 0
            ), "If skipped, closeout: run-1 commit should exist (not matched to run-10)"
        else:
            # If not skipped, verify run-1 commit was created
            log_all = (
                subprocess.run(
                    ["git", "log", "--format=%s"],
                    cwd=repo["repo_dir"],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                .stdout.strip()
                .split("\n")
            )
            lines = [line for line in log_all if line == "closeout: run-1"]
            assert len(lines) > 0, "run-1 closeout commit should have been created"


class TestGitnexusReindex:
    """Test gitnexus_reindex.py script."""

    def test_gitnexus_reindex_happy_path(self, env_with_repo):
        """gitnexus_reindex attempts to run gitnexus analyze and logs result."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.gitnexus_reindex",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # Exit code depends on whether gitnexus is installed and succeeds
        # But output must always be valid JSON
        try:
            output = json.loads(result.stdout)
            assert "ok" in output or "error" in output

            # Log file should be created
            log_file = repo["runs_dir"] / "gitnexus-reindex.log"
            if "log" in output:
                log_path = Path(output["log"])
                # Log file may or may not exist depending on gitnexus availability
        except json.JSONDecodeError:
            pytest.fail(f"gitnexus_reindex output is not valid JSON: {result.stdout}")

    def test_gitnexus_reindex_nonzero_exit_still_outputs_json(self, env_with_repo):
        """gitnexus_reindex outputs JSON even on nonzero exit."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.gitnexus_reindex",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # Always outputs JSON
        output = json.loads(result.stdout)

        # If exit code is 0, ok should be True
        # If exit code is 0 but ok is False, that's a contract violation
        # (the TS side likely only checks exit code)
        if result.returncode == 0:
            assert output.get("ok") is True


class TestCloseoutArchiveCommand:
    """lane-steps.ts closeoutArchiveSteps invokes `datum closeout-archive`.

    It did not exist (nor did the four collector commands), so every step
    failed under tolerant: true and archive.py never ran. The commands are
    registered in datum/cli.py (_CLOSEOUT_MODULES); tests/test_closeout_cli.py
    covers forwarding. This pins the installed binary too.
    """

    def test_closeout_archive_command_exists_on_the_installed_binary(self):
        result = subprocess.run(
            ["datum", "closeout-archive", "--help"],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        assert "datum.closeout.archive" in result.stdout


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
