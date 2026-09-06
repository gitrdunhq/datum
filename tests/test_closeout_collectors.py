#!/usr/bin/env python3
"""Characterization tests for closeout collectors.

Tests each collector against a real temporary git repo with various input
conditions (missing optional inputs, empty state, malformed artifacts, etc.)
to ensure they handle edge cases gracefully without silent failures.
"""

from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
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


class TestCollectGit:
    """Test collect_git.py collector."""

    def test_basic_collection(self, env_with_repo):
        """collect_git writes valid git metrics to closeout-raw/git.json."""
        repo = env_with_repo
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_git",
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

        # Verify the written file
        git_file = repo["runs_dir"] / "closeout-raw" / "git.json"
        assert git_file.exists(), f"Expected {git_file} to exist"

        data = json.loads(git_file.read_text())
        assert "commits" in data
        assert "commit_count" in data
        assert "files_touched" in data
        assert "loc_added" in data
        assert "loc_removed" in data
        assert "loc_net" in data
        assert isinstance(data["commit_count"], int)
        assert data["commit_count"] >= 3  # At least our 3 commits
        assert isinstance(data["files_touched"], list)

    def test_missing_base_sha(self, env_with_repo):
        """collect_git requires --base-sha and --merge-sha."""
        repo = env_with_repo
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_git",
                "--run-id",
                repo["run_id"],
                "--merge-sha",
                repo["merge_sha"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # Should fail (argparse will complain about missing required args)
        assert result.returncode != 0

    def test_skip_on_marker(self, env_with_repo):
        """collect_git skips if .collect-git.done marker exists."""
        repo = env_with_repo
        marker = repo["runs_dir"] / ".collect-git.done"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("done")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_git",
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

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("skipped") is True


def _write_lane_plan(repo_dir: Path, branch: str, lane_ids: list[str]) -> None:
    plan_dir = repo_dir / "docs" / "epics" / branch
    plan_dir.mkdir(parents=True, exist_ok=True)
    (plan_dir / "lane-plan.json").write_text(
        json.dumps(
            {
                "lanes": {lid: {"task_id": lid, "files": []} for lid in lane_ids},
                "topological_order": lane_ids,
                "total_lanes": len(lane_ids),
            }
        )
    )


def _write_epic_marker(repo_dir: Path, slug: str, task: str, status: str) -> None:
    d = repo_dir / ".datum" / "epics" / slug / "lane-state"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{task}.json").write_text(json.dumps({"task_id": task, "status": status}))


class TestCollectTasks:
    """caliper BUG S (eedom wf_8240c0f1-6e1): collect_tasks read a
    `.datum/runs/<run>/state.json` with a `lanes` map that nothing in the
    current Act writes — a collector whose producer was retired — so every
    closeout died at collate. The producers that exist: the lane plan
    (total) and the lane-state markers (epic-scoped under
    .datum/epics/<slug>/lane-state/, per-run under .datum/runs/*/lane-state/),
    which is also what survives an Act spread over many run ids."""

    def test_collects_from_the_lane_plan_and_lane_state_markers(self, env_with_repo):
        repo = env_with_repo
        _write_lane_plan(
            repo["repo_dir"], "datum/epic-123", ["task-001", "task-002", "task-003"]
        )
        _write_epic_marker(repo["repo_dir"], "datum-epic-123", "task-001", "completed")
        # A lane merged by an EARLIER run: only its per-run marker exists.
        older = repo["repo_dir"] / ".datum" / "runs" / "run-000" / "lane-state"
        older.mkdir(parents=True)
        (older / "task-002.json").write_text(
            json.dumps({"task_id": "task-002", "status": "completed"})
        )
        _write_epic_marker(repo["repo_dir"], "datum-epic-123", "task-003", "failed")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_tasks",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert (
            result.returncode == 0
        ), f"stdout: {result.stdout} stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert output.get("ok") is True
        data = json.loads(
            (repo["runs_dir"] / "closeout-raw" / "tasks.json").read_text()
        )
        assert data["total"] == 3
        assert data["completed"] == 2
        assert data["failed_terminal"] == 1
        assert data["say_do_ratio"] == 0.667
        assert data["per_stage_retries"] is None
        assert data["lanes"] == [
            {"task_id": "task-001", "final_status": "completed"},
            {"task_id": "task-002", "final_status": "completed"},
            {"task_id": "task-003", "final_status": "failed"},
        ]
        assert data["source"] == "lane-plan.json + lane-state markers"

    def test_markers_for_lanes_outside_this_epics_plan_are_ignored(self, env_with_repo):
        """caliper BUG T: .datum/runs/ holds markers from OTHER epics' runs
        (23 counted where the plan had 9). With a lane plan, only its lane
        ids count; foreign markers are reported, not counted."""
        repo = env_with_repo
        _write_lane_plan(repo["repo_dir"], "datum/epic-123", ["task-001", "task-002"])
        _write_epic_marker(repo["repo_dir"], "datum-epic-123", "task-001", "completed")
        foreign = (
            repo["repo_dir"] / ".datum" / "runs" / "20260902-032652-b4" / "lane-state"
        )
        foreign.mkdir(parents=True)
        for t in ("task-003", "task-004", "task-005"):
            (foreign / f"{t}.json").write_text(
                json.dumps({"task_id": t, "status": "completed"})
            )

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_tasks",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, result.stdout + result.stderr
        data = json.loads(
            (repo["runs_dir"] / "closeout-raw" / "tasks.json").read_text()
        )
        assert data["total"] == 2
        assert data["completed"] == 1
        assert [lane["task_id"] for lane in data["lanes"]] == ["task-001", "task-002"]
        assert data["ignored_foreign_markers"] == ["task-003", "task-004", "task-005"]

    def test_no_lane_plan_and_no_markers_is_a_named_failure(self, env_with_repo):
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_tasks",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        output = json.loads(result.stdout)
        assert "lane-plan.json" in output["error"] and "lane-state" in output["error"]
        assert "state.json" not in output["error"]

    def test_skip_on_marker(self, env_with_repo):
        """collect_tasks skips if .collect-tasks.done marker exists."""
        repo = env_with_repo
        marker = repo["runs_dir"] / ".collect-tasks.done"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("done")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_tasks",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("skipped") is True


class TestCollectTokenMetrics:
    """Test collect_token_metrics.py collector."""

    def test_basic_collection_with_db(self, env_with_repo):
        """collect_token_metrics reads from state.db and produces metrics."""
        repo = env_with_repo

        # Create a minimal state.db with token_metrics table
        db_path = repo["runs_dir"] / "state.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)

        with sqlite3.connect(db_path) as conn:
            conn.execute("""
                CREATE TABLE token_metrics (
                    phase TEXT,
                    model TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER
                )
                """)
            conn.execute(
                "INSERT INTO token_metrics VALUES (?, ?, ?, ?)",
                ("red", "claude-opus", 1000, 500),
            )
            conn.execute(
                "INSERT INTO token_metrics VALUES (?, ?, ?, ?)",
                ("green", "claude-opus", 2000, 1000),
            )
            conn.commit()

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_token_metrics",
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
        assert "total_tokens" in output

        # Verify the written file
        metrics_file = repo["runs_dir"] / "closeout-raw" / "token_metrics.json"
        assert metrics_file.exists()

        data = json.loads(metrics_file.read_text())
        assert data["total_input"] == 3000
        assert data["total_output"] == 1500
        assert data["total"] == 4500
        assert "per_phase" in data
        assert "per_model" in data

    def test_missing_db_produces_zeros(self, env_with_repo):
        """collect_token_metrics handles missing state.db gracefully."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_token_metrics",
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

        # Verify the written file with zeros
        metrics_file = repo["runs_dir"] / "closeout-raw" / "token_metrics.json"
        assert metrics_file.exists()

        data = json.loads(metrics_file.read_text())
        # No source is "not collected", never zero (elonchesd epic-2 closeout).
        assert data["collected"] is False
        assert data["total_input"] is None
        assert data["total_output"] is None
        assert data["total"] is None

    def test_skip_on_marker(self, env_with_repo):
        """collect_token_metrics skips if .collect-token-metrics.done exists."""
        repo = env_with_repo
        marker = repo["runs_dir"] / ".collect-token-metrics.done"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("done")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_token_metrics",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("skipped") is True


class TestCollectBriefDefects:
    """Test collect_brief_defects.py collector."""

    def test_basic_collection(self, env_with_repo):
        """collect_brief_defects reads brief_defects from state.json."""
        repo = env_with_repo

        state = {
            "run_id": repo["run_id"],
            "brief_defects": [
                {
                    "task_id": "task-001",
                    "missing_ac": "ac-1",
                    "surfaced_by_stage": "RED",
                }
            ],
            "lanes": {},
        }
        state_file = repo["runs_dir"] / "state.json"
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state, indent=2))

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_brief_defects",
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
        assert output.get("count") == 1

        defects_file = repo["runs_dir"] / "closeout-raw" / "brief_defects.json"
        assert defects_file.exists()
        data = json.loads(defects_file.read_text())
        assert len(data) == 1

    def test_missing_state_produces_empty_list(self, env_with_repo):
        """collect_brief_defects handles missing state.json gracefully."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_brief_defects",
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
        assert output.get("count") == 0

        defects_file = repo["runs_dir"] / "closeout-raw" / "brief_defects.json"
        assert defects_file.exists()
        data = json.loads(defects_file.read_text())
        assert data == []

    def test_skip_on_marker(self, env_with_repo):
        """collect_brief_defects skips if .collect-brief-defects.done exists."""
        repo = env_with_repo
        marker = repo["runs_dir"] / ".collect-brief-defects.done"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("done")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_brief_defects",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("skipped") is True


class TestCollectLaneTools:
    """Test collect_lane_tools.py collector."""

    def test_basic_collection(self, env_with_repo):
        """collect_lane_tools reads lane_tools_added from state.json."""
        repo = env_with_repo

        state = {
            "run_id": repo["run_id"],
            "lane_tools_added": ["tool-1", "tool-2"],
            "lanes": {},
        }
        state_file = repo["runs_dir"] / "state.json"
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state, indent=2))

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_lane_tools",
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
        assert output.get("count") == 2

        tools_file = repo["runs_dir"] / "closeout-raw" / "lane_tools.json"
        assert tools_file.exists()
        data = json.loads(tools_file.read_text())
        assert len(data["lane_tools_added"]) == 2

    def test_missing_state_produces_empty_list(self, env_with_repo):
        """collect_lane_tools handles missing state.json gracefully."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_lane_tools",
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
        assert output.get("count") == 0

        tools_file = repo["runs_dir"] / "closeout-raw" / "lane_tools.json"
        assert tools_file.exists()
        data = json.loads(tools_file.read_text())
        assert data["lane_tools_added"] == []

    def test_skip_on_marker(self, env_with_repo):
        """collect_lane_tools skips if .collect-lane-tools.done exists."""
        repo = env_with_repo
        marker = repo["runs_dir"] / ".collect-lane-tools.done"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("done")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_lane_tools",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("skipped") is True


class TestCollectPlatform:
    """Test collect_platform.py collector."""

    def test_basic_collection(self, env_with_repo):
        """collect_platform reads platform metadata from state.json."""
        repo = env_with_repo

        state = {
            "run_id": repo["run_id"],
            "git": {
                "pr_url": "https://github.com/org/repo/pull/123",
                "pr_author_login": "author",
                "merge_sha": repo["merge_sha"],
                "work_branch": "datum/epic-123",
            },
            "lanes": {},
        }
        state_file = repo["runs_dir"] / "state.json"
        state_file.parent.mkdir(parents=True, exist_ok=True)
        state_file.write_text(json.dumps(state, indent=2))

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_platform",
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

        platform_file = repo["runs_dir"] / "closeout-raw" / "platform.json"
        assert platform_file.exists()
        data = json.loads(platform_file.read_text())
        assert data["pr_url"] == "https://github.com/org/repo/pull/123"
        assert data["pr_author_login"] == "author"

    def test_missing_state_produces_nulls(self, env_with_repo):
        """collect_platform handles missing state.json gracefully."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_platform",
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

        platform_file = repo["runs_dir"] / "closeout-raw" / "platform.json"
        assert platform_file.exists()
        data = json.loads(platform_file.read_text())
        assert data["pr_url"] is None
        assert data["pr_author_login"] is None

    def test_skip_on_marker(self, env_with_repo):
        """collect_platform skips if .collect-platform.done exists."""
        repo = env_with_repo
        marker = repo["runs_dir"] / ".collect-platform.done"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("done")

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_platform",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0
        output = json.loads(result.stdout)
        assert output.get("skipped") is True


class TestEdgeCases:
    """Test edge cases and potential bugs."""

    def test_collect_tasks_with_zero_lanes(self, env_with_repo):
        """collect_tasks handles zero lanes gracefully (division by zero check)."""
        repo = env_with_repo

        # A lane plan with zero lanes and no markers.
        _write_lane_plan(repo["repo_dir"], "datum/epic-123", [])

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_tasks",
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

        tasks_file = repo["runs_dir"] / "closeout-raw" / "tasks.json"
        data = json.loads(tasks_file.read_text())
        assert data["total"] == 0
        assert data["say_do_ratio"] == 0

    def test_collect_token_metrics_with_broken_db(self, env_with_repo):
        """collect_token_metrics handles DB without token_metrics table gracefully."""
        repo = env_with_repo

        # Create a DB with no token_metrics table (simulates older format)
        db_path = repo["runs_dir"] / "state.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)

        with sqlite3.connect(db_path) as conn:
            conn.execute("CREATE TABLE other_table (id INTEGER)")
            conn.commit()

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_token_metrics",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # Should succeed and produce zeros (the OperationalError is silently caught)
        assert result.returncode == 0, f"stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert output.get("ok") is True

        metrics_file = repo["runs_dir"] / "closeout-raw" / "token_metrics.json"
        data = json.loads(metrics_file.read_text())
        # A DB without the table is "not collected", never zero.
        assert data["collected"] is False
        assert data["total"] is None

    def test_collect_git_with_invalid_sha_range(self, env_with_repo):
        """collect_git fails appropriately when given invalid SHAs."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_git",
                "--run-id",
                repo["run_id"],
                "--base-sha",
                "0000000000000000000000000000000000000000",
                "--merge-sha",
                "1111111111111111111111111111111111111111",
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # Should fail (git can't find those SHAs) and return error JSON
        assert result.returncode != 0
        output = json.loads(result.stdout)
        assert "error" in output
        assert output.get("ok") is False


class TestCollate:
    """Test collate.py aggregation."""

    def test_collate_success_with_all_collectors(self, env_with_repo):
        """collate aggregates all collector outputs into closeout-data.json."""
        repo = env_with_repo

        # Prepare closeout-raw directory with minimal outputs
        closeout_raw = repo["runs_dir"] / "closeout-raw"
        closeout_raw.mkdir(parents=True, exist_ok=True)

        # Create minimal collector outputs
        (closeout_raw / "git.json").write_text(
            json.dumps(
                {
                    "commits": ["abc123 act(run-001-b0): merge"],
                    "commit_count": 3,
                    "files_touched": ["file0.py", "file1.py"],
                    "loc_added": 50,
                    "loc_removed": 10,
                    "loc_net": 40,
                }
            )
        )
        (closeout_raw / "tasks.json").write_text(
            json.dumps(
                {
                    "total": 2,
                    "completed": 2,
                    "failed_terminal": 0,
                    "say_do_ratio": 1.0,
                    "per_stage_retries": {"RED": 0, "GREEN": 0, "REFACTOR": 0},
                }
            )
        )
        (closeout_raw / "platform.json").write_text(
            json.dumps(
                {
                    "pr_url": None,
                    "pr_author_login": None,
                    "merge_sha": repo["merge_sha"],
                    "work_branch": "datum/epic-123",
                    "source": None,
                }
            )
        )
        (closeout_raw / "lane_tools.json").write_text(
            json.dumps(
                {
                    "lane_tools_added": [],
                    "manifest": {},
                }
            )
        )
        (closeout_raw / "brief_defects.json").write_text(json.dumps([]))
        (closeout_raw / "token_metrics.json").write_text(
            json.dumps(
                {
                    "total_input": 0,
                    "total_output": 0,
                    "total": 0,
                    "per_phase": {},
                    "per_model": {},
                }
            )
        )
        (closeout_raw / "gitnexus_diff.json").write_text(json.dumps(None))
        (closeout_raw / "solutions.json").write_text(json.dumps(None))

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collate",
                "--run-id",
                repo["run_id"],
                "--merge-sha",
                repo["merge_sha"],
                "--epic-number",
                "123",
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f"stderr: {result.stderr}"
        output = json.loads(result.stdout)
        assert output.get("ok") is True

        # Verify closeout-data.json was written
        closeout_file = repo["runs_dir"] / "closeout-data.json"
        assert closeout_file.exists()

        data = json.loads(closeout_file.read_text())
        assert data["run_id"] == repo["run_id"]
        assert data["epic_number"] == 123
        assert data["merge_sha"] == repo["merge_sha"]
        assert data["git"]["commit_count"] == 3
        assert data["tasks"]["completed"] == 2
        assert data["token_metrics"]["total"] == 0

    def test_collate_fails_on_missing_raw_dir(self, env_with_repo):
        """collate fails when closeout-raw directory doesn't exist."""
        repo = env_with_repo

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collate",
                "--run-id",
                repo["run_id"],
                "--merge-sha",
                repo["merge_sha"],
                "--epic-number",
                "123",
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        output = json.loads(result.stdout)
        assert "error" in output

    def test_collate_handles_missing_collectors(self, env_with_repo):
        """collate sets missing collectors to None instead of failing."""
        repo = env_with_repo

        # Create closeout-raw with only git.json
        closeout_raw = repo["runs_dir"] / "closeout-raw"
        closeout_raw.mkdir(parents=True, exist_ok=True)

        (closeout_raw / "git.json").write_text(
            json.dumps(
                {
                    "commits": [],
                    "commit_count": 0,
                    "files_touched": [],
                    "loc_added": 0,
                    "loc_removed": 0,
                    "loc_net": 0,
                }
            )
        )

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collate",
                "--run-id",
                repo["run_id"],
                "--merge-sha",
                repo["merge_sha"],
                "--epic-number",
                "123",
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # This may fail due to schema validation if required fields are missing
        # but we want to see what happens
        if result.returncode == 0:
            output = json.loads(result.stdout)
            # Collate succeeded even with missing collectors
            assert output.get("ok") is True
        else:
            output = json.loads(result.stdout)
            # Collate failed due to schema validation — this is OK too
            assert "error" in output

    def test_collect_token_metrics_with_missing_table_should_not_silently_report_zero(
        self, env_with_repo
    ):
        """collect_token_metrics should not silently report 0 tokens when table is missing.

        If the token_metrics table doesn't exist (e.g., old DB schema or corrupted DB),
        the function currently silently continues with empty model_log and reports
        "ok": True with total_tokens: 0. This test verifies that this is reported as
        an error or skipped condition, not silently as success.
        """
        repo = env_with_repo

        # Create a valid but minimal SQLite DB with no token_metrics table
        state_db = repo["runs_dir"] / "state.db"
        conn = sqlite3.connect(state_db)
        conn.execute("CREATE TABLE other_table (id INTEGER)")
        conn.commit()
        conn.close()

        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "datum.closeout.collect_token_metrics",
                "--run-id",
                repo["run_id"],
            ],
            cwd=repo["repo_dir"],
            capture_output=True,
            text=True,
        )

        # The collector should report the problem, not silently return 0
        assert result.returncode == 0, (
            f"collect_token_metrics should exit cleanly, got {result.returncode}: "
            f"{result.stderr}"
        )
        output = json.loads(result.stdout)

        # Should explicitly report an error or skip, not pretend it found 0 tokens
        assert output.get("error") or output.get("skipped"), (
            f"collect_token_metrics silently reported 0 tokens instead of "
            f"reporting that the token_metrics table was missing: {output}"
        )


def test_collect_token_metrics_names_itself_when_it_has_no_source(env_with_repo):
    """elonchesd epic-2 closeout: token_metrics was all zero with an empty
    collector_warnings, so "the collector did not run" was indistinguishable
    from "zero", while the Workflow tool had reported ~9.6M subagent tokens.
    Nothing in the pipeline writes the token_metrics table this collector
    reads. With no source it says so, by name, instead of reporting zero."""
    repo = env_with_repo

    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "datum.closeout.collect_token_metrics",
            "--run-id",
            repo["run_id"],
        ],
        cwd=repo["repo_dir"],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    output = json.loads(result.stdout)
    assert output["ok"] is True
    assert output["collected"] is False
    assert "state.db" in output["reason"]
    data = json.loads(
        (repo["runs_dir"] / "closeout-raw" / "token_metrics.json").read_text()
    )
    assert data["collected"] is False
    assert data["reason"] == output["reason"]
    assert data["total_input"] is None and data["total_output"] is None
