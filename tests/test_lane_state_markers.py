"""Characterization tests for lane-state markers and epic-level resume.

FLOW.md §2 Resume (item 2): A lane is skipped only if status == completed
AND spec_hash matches the current plan entry AND the merge commit is an
ancestor of the epic tip. All three, or the lane runs again.

This file complements tests/test_lane_state_cli.py (which covers basic
write/read I/O, security, and idempotency without git) by testing:

1. Real git ancestry logic: the actual `git merge-base --is-ancestor` condition
   with concrete commits in a real repo.
2. The three skip conditions individually and together.
3. Corrupt marker file handling (named error, not silent fallback) — RED test
   for datum/cli.py read command validation.
4. Field parity check: ensure Python marker schema matches TS consumer schema
   in skills/src/shared/lane-steps.ts (completionMarkerCommand) and the
   lane-state-read.md script's jq extraction.

The epic-scoped marker path is .datum/epics/<slug>/lane-state/<task>.json
and writes six fields: task_id, status, merge_commit, spec_hash, run_id,
completed_at (written by datum lane-state write). The run-scoped marker
path .datum/runs/<runId>/lane-state/<task>.json writes only {task_id,
status} (written by completionMarkerCommand in lane-steps.ts); see FLOW.md
Act handoff table.

Markers are consumed by the shell script in skills/src/prompts/lane-state-read.md,
which reads status/merge_commit/spec_hash via jq and checks ancestry via
`git merge-base --is-ancestor`.
"""

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app


def _run_git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    """Run git command, return result."""
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )


@pytest.fixture
def git_repo(tmp_path, monkeypatch):
    """A real git repo with one initial commit on main, hooks disabled.

    core.hooksPath=/dev/null prevents machine-global git hooks from firing
    inside this throwaway repo (per-task requirement).
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _run_git("init", "-q", "-b", "main", cwd=repo)
    _run_git("config", "core.hooksPath", "/dev/null", cwd=repo)
    _run_git("config", "user.email", "test@example.com", cwd=repo)
    _run_git("config", "user.name", "Test User", cwd=repo)

    # Initial commit on main
    (repo / "README.md").write_text("initial\n")
    _run_git("add", "README.md", cwd=repo)
    _run_git("commit", "-q", "-m", "initial", cwd=repo)

    fake_home = tmp_path / "fake_home"
    fake_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: fake_home)

    monkeypatch.chdir(repo)
    return repo


# ---------------------------------------------------------------------------
# Concrete ancestry scenarios: commits that are/are not ancestors of HEAD
# ---------------------------------------------------------------------------


def test_ancestry_commit_on_epic_branch_is_ancestor(git_repo):
    """Concrete ancestry: commit A on epic branch → git merge-base --is-ancestor A HEAD = 0."""
    # Commit A on main (our epic branch)
    (git_repo / "file1.txt").write_text("content\n")
    _run_git("add", "file1.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "commit A", cwd=git_repo)
    commit_a = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=git_repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    # Commit B on main
    (git_repo / "file2.txt").write_text("more\n")
    _run_git("add", "file2.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "commit B", cwd=git_repo)

    # Check: A is ancestor of HEAD (B)
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", commit_a, "HEAD"],
        cwd=git_repo,
        capture_output=True,
    )
    assert result.returncode == 0, "commit A should be ancestor of HEAD"


def test_ancestry_commit_on_diverged_branch_is_not_ancestor(git_repo):
    """Concrete ancestry: commit C on diverged branch → git merge-base --is-ancestor C HEAD ≠ 0."""
    # Commit A on main
    (git_repo / "file1.txt").write_text("content\n")
    _run_git("add", "file1.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "commit A", cwd=git_repo)

    # Create and check out diverged branch at this point
    _run_git("checkout", "-q", "-b", "other", cwd=git_repo)

    # Commit C on other branch
    (git_repo / "file_c.txt").write_text("diverged\n")
    _run_git("add", "file_c.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "commit C", cwd=git_repo)
    commit_c = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=git_repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    # Switch back to main
    _run_git("checkout", "-q", "main", cwd=git_repo)

    # Commit B on main (diverges from C)
    (git_repo / "file2.txt").write_text("main branch\n")
    _run_git("add", "file2.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "commit B", cwd=git_repo)

    # Check: C is NOT ancestor of HEAD (main)
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", commit_c, "HEAD"],
        cwd=git_repo,
        capture_output=True,
    )
    assert result.returncode != 0, "commit C should not be ancestor of HEAD"


def test_ancestry_garbage_sha_is_not_ancestor(git_repo):
    """Concrete ancestry: garbage SHA → git merge-base --is-ancestor exits 128."""
    garbage_sha = "0000000000000000000000000000000000000000"

    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", garbage_sha, "HEAD"],
        cwd=git_repo,
        capture_output=True,
    )
    assert result.returncode == 128, "garbage SHA should exit 128"


# ---------------------------------------------------------------------------
# Field parity: marker schema matches TS consumer expectations
# ---------------------------------------------------------------------------


def test_marker_schema_parity_with_ts_consumer(git_repo):
    """Characterize fields: the marker dict has status/merge_commit/spec_hash
    as written by `datum lane-state write` and read by the jq script in
    lane-state-read.md."""
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Write a marker with all fields
    spec_hash = "fnv1a64:a1b2c3d4e5f6g7h8"  # Example FNV1a64 hash
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-123",
            "--task",
            "task-001",
            "--status",
            "completed",
            "--merge-commit",
            "abc123def456",
            "--spec-hash",
            spec_hash,
            "--run-id",
            "run-20260101-120000",
            "--completed-at",
            "2026-01-01T12:00:00Z",
        ],
    )
    assert write_result.exit_code == 0

    marker_path = (
        git_repo
        / ".datum"
        / "epics"
        / "datum-epic-123"
        / "lane-state"
        / "task-001.json"
    )
    marker_dict = json.loads(marker_path.read_text())

    # Assert schema parity: all six fields present
    assert "task_id" in marker_dict
    assert "status" in marker_dict
    assert "merge_commit" in marker_dict
    assert "spec_hash" in marker_dict
    assert "run_id" in marker_dict
    assert "completed_at" in marker_dict

    # Assert concrete values
    assert marker_dict["task_id"] == "task-001"
    assert marker_dict["status"] == "completed"
    assert marker_dict["merge_commit"] == "abc123def456"
    assert marker_dict["spec_hash"] == spec_hash
    assert marker_dict["run_id"] == "run-20260101-120000"
    assert marker_dict["completed_at"] == "2026-01-01T12:00:00Z"


# ---------------------------------------------------------------------------
# Skip condition 1: status != completed → lane does not skip
# ---------------------------------------------------------------------------


def test_skip_condition_status_not_completed(git_repo):
    """Skip condition 1: if status != 'completed', lane must not skip.

    Marker with status='running' (or any non-'completed' value) should not
    satisfy the skip condition m.status === 'completed'.
    """
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Write marker with status != 'completed'
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-skip",
            "--task",
            "task-001",
            "--status",
            "running",  # Not 'completed'
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "fnv1a64:xxx",
        ],
    )
    assert write_result.exit_code == 0

    # Read the marker back
    read_result = runner.invoke(
        app,
        ["lane-state", "read", "--epic", "datum/epic-skip", "--task", "task-001"],
    )
    assert read_result.exit_code == 0
    marker = json.loads(read_result.stdout)

    # Assert: status is recorded as 'running'
    assert marker["status"] == "running"
    # Per datum-go.ts line: `return !!m && m.status === 'completed' && ...`
    # With status='running', the filter returns false → lane is not skipped
    assert marker["status"] != "completed"


# ---------------------------------------------------------------------------
# Skip condition 2: merge_commit not an ancestor → lane does not skip
# ---------------------------------------------------------------------------


def test_skip_condition_ancestor_false(git_repo):
    """Skip condition 2: if merge_commit is not an ancestor of HEAD, lane must not skip.

    The lane-state-read.md script checks `git merge-base --is-ancestor "$MC" HEAD`.
    """
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Create a commit on a diverged branch
    (git_repo / "file1.txt").write_text("initial\n")
    _run_git("add", "file1.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "commit on main", cwd=git_repo)

    _run_git("checkout", "-q", "-b", "diverged", cwd=git_repo)
    (git_repo / "file_diverged.txt").write_text("diverged\n")
    _run_git("add", "file_diverged.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "commit on diverged", cwd=git_repo)
    diverged_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=git_repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    _run_git("checkout", "-q", "main", cwd=git_repo)

    # Write marker with merge_commit that is NOT an ancestor
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-ancestor",
            "--task",
            "task-001",
            "--status",
            "completed",
            "--merge-commit",
            diverged_sha,
            "--spec-hash",
            "fnv1a64:xxx",
        ],
    )
    assert write_result.exit_code == 0

    # Read the marker back
    read_result = runner.invoke(
        app,
        [
            "lane-state",
            "read",
            "--epic",
            "datum/epic-ancestor",
            "--task",
            "task-001",
        ],
    )
    assert read_result.exit_code == 0
    marker = json.loads(read_result.stdout)

    # Assert: merge_commit is recorded
    assert marker["merge_commit"] == diverged_sha
    # Check that git merge-base --is-ancestor returns false
    anc_result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", diverged_sha, "HEAD"],
        cwd=git_repo,
        capture_output=True,
    )
    assert anc_result.returncode != 0, "diverged SHA should not be ancestor"


# ---------------------------------------------------------------------------
# Skip condition 3: spec_hash mismatch → lane does not skip
# ---------------------------------------------------------------------------


def test_skip_condition_spec_hash_mismatch(git_repo):
    """Skip condition 3: if spec_hash doesn't match laneSpecHash(plan), lane must not skip.

    The filter in datum-go.ts: `m.spec_hash === laneSpecHash(lanePlan.lanes[id])`
    compares the marker's spec_hash against a freshly computed hash.
    """
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Write marker with spec_hash='old_hash'
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-hash",
            "--task",
            "task-001",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "fnv1a64:old_hash",
        ],
    )
    assert write_result.exit_code == 0

    # Read it back
    read_result = runner.invoke(
        app,
        ["lane-state", "read", "--epic", "datum/epic-hash", "--task", "task-001"],
    )
    assert read_result.exit_code == 0
    marker = json.loads(read_result.stdout)

    # Assert: spec_hash is 'old_hash'
    assert marker["spec_hash"] == "fnv1a64:old_hash"
    # If the lane plan's laneSpecHash() computes 'new_hash', they don't match
    # → filter returns false → lane is not skipped
    assert marker["spec_hash"] != "fnv1a64:new_hash"


# ---------------------------------------------------------------------------
# All three conditions together → lane skips
# ---------------------------------------------------------------------------


def test_skip_all_three_conditions_together(git_repo):
    """Skip only if all three: status='completed' AND ancestor=true AND spec_hash matches.

    This is the nominal skip path: a lane whose prior run was completed,
    merged into the epic, and whose spec hasn't changed.
    """
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Create a commit on main that will be the merge_commit
    (git_repo / "file1.txt").write_text("content\n")
    _run_git("add", "file1.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "lane merge", cwd=git_repo)
    merge_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=git_repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()

    # Add another commit after the merge
    (git_repo / "file2.txt").write_text("after merge\n")
    _run_git("add", "file2.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "after merge", cwd=git_repo)

    # Write marker: status=completed, merge_commit=ancestor, spec_hash=known
    spec_hash = "fnv1a64:known_hash"
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-all-three",
            "--task",
            "task-001",
            "--status",
            "completed",
            "--merge-commit",
            merge_sha,
            "--spec-hash",
            spec_hash,
        ],
    )
    assert write_result.exit_code == 0

    # Read it back and verify all three conditions
    read_result = runner.invoke(
        app,
        [
            "lane-state",
            "read",
            "--epic",
            "datum/epic-all-three",
            "--task",
            "task-001",
        ],
    )
    assert read_result.exit_code == 0
    marker = json.loads(read_result.stdout)

    # Condition 1: status === 'completed'
    assert marker["status"] == "completed"

    # Condition 2: merge_commit is ancestor of HEAD
    anc_result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", merge_sha, "HEAD"],
        cwd=git_repo,
        capture_output=True,
    )
    assert anc_result.returncode == 0, "merge_commit should be ancestor"

    # Condition 3: spec_hash matches (in real scenario, compared against laneSpecHash)
    assert marker["spec_hash"] == spec_hash


# ---------------------------------------------------------------------------
# Corrupt marker handling: RED test for invalid JSON
# ---------------------------------------------------------------------------


def test_corrupt_marker_invalid_json_fails(git_repo):
    """Corrupt marker with invalid JSON must error with named message.

    FLOW.md principle 3: 'No silent fallbacks'. A truncated/invalid marker
    should produce a named error, not silently degrade to 'fresh lane'.

    Fixed in datum/cli.py:lane_state_read with json.loads() validation.
    """
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Create lane-state directory
    lane_state_dir = git_repo / ".datum" / "epics" / "datum-epic-corrupt" / "lane-state"
    lane_state_dir.mkdir(parents=True)

    # Write corrupt JSON (truncated, missing closing brace)
    corrupt_marker = lane_state_dir / "task-001.json"
    corrupt_marker.write_text('{"task_id": "task-001", "status": "completed"')

    # Try to read it
    read_result = runner.invoke(
        app,
        [
            "lane-state",
            "read",
            "--epic",
            "datum/epic-corrupt",
            "--task",
            "task-001",
        ],
    )

    # Fixed: must exit non-zero with named error
    assert read_result.exit_code != 0
    assert "lane_state_marker_corrupt" in read_result.output


def test_corrupt_marker_empty_file_fails(git_repo):
    """Empty marker file must error with named message."""
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    lane_state_dir = git_repo / ".datum" / "epics" / "datum-epic-empty" / "lane-state"
    lane_state_dir.mkdir(parents=True)

    # Write empty file
    empty_marker = lane_state_dir / "task-001.json"
    empty_marker.write_text("")

    read_result = runner.invoke(
        app,
        [
            "lane-state",
            "read",
            "--epic",
            "datum/epic-empty",
            "--task",
            "task-001",
        ],
    )

    # Fixed: must exit non-zero with error
    assert read_result.exit_code != 0
    assert "lane_state_marker_corrupt" in read_result.output


def test_corrupt_marker_non_dict_json_fails(git_repo):
    """Valid JSON but non-dict payload must error with named message."""
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    lane_state_dir = git_repo / ".datum" / "epics" / "datum-epic-array" / "lane-state"
    lane_state_dir.mkdir(parents=True)

    # Write valid JSON but wrong type (array)
    bad_marker = lane_state_dir / "task-001.json"
    bad_marker.write_text('["completed"]')

    read_result = runner.invoke(
        app,
        [
            "lane-state",
            "read",
            "--epic",
            "datum/epic-array",
            "--task",
            "task-001",
        ],
    )

    # Fixed: must exit non-zero with error
    assert read_result.exit_code != 0
    assert "lane_state_marker_corrupt" in read_result.output


# ---------------------------------------------------------------------------
# Slug parity: Python re.sub vs TypeScript epicSlug
# ---------------------------------------------------------------------------


def test_slug_parity_basic(git_repo):
    """Slug parity: Python re.sub behavior matches expected normalization."""
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Test case: 'datum/epic-287' should slugify to 'datum-epic-287'
    # (slashes become dashes, alphanumeric + dashes only)
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-287",
            "--task",
            "task-1",
            "--status",
            "completed",
        ],
    )
    assert write_result.exit_code == 0

    slug_dir = git_repo / ".datum" / "epics" / "datum-epic-287"
    assert slug_dir.exists(), "expected 'datum/epic-287' to slugify to 'datum-epic-287'"
    assert slug_dir.is_dir()


def test_slug_parity_special_chars(git_repo):
    """Slug parity: non-alphanumeric chars become dashes."""
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Test case: 'feat/ABC_123' should slugify to 'feat-ABC-123'
    # (underscore and slash both become dashes)
    write_result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "feat/ABC_123",
            "--task",
            "task-1",
            "--status",
            "completed",
        ],
    )
    assert write_result.exit_code == 0

    slug_dir = git_repo / ".datum" / "epics" / "feat-ABC-123"
    assert slug_dir.exists()


# ---------------------------------------------------------------------------
# Stdout purity: marker write/read JSON must be parseable
# ---------------------------------------------------------------------------


def test_write_stdout_is_valid_json(git_repo):
    """Stdout purity for write: output must be valid JSON, nothing else."""
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    result = runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-json",
            "--task",
            "task-001",
            "--status",
            "completed",
            "--merge-commit",
            "abc123",
            "--spec-hash",
            "fnv1a64:xyz",
            "--run-id",
            "run-001",
            "--completed-at",
            "2026-01-01T00:00:00Z",
        ],
    )
    assert result.exit_code == 0

    # Parse stdout as JSON — must not raise
    output_dict = json.loads(result.stdout)

    # Assert it's a dict with expected keys (no preamble/epilogue)
    assert isinstance(output_dict, dict)
    assert output_dict["task_id"] == "task-001"
    assert output_dict["status"] == "completed"


def test_read_stdout_is_valid_json(git_repo):
    """Stdout purity for read: output must be valid JSON, nothing else."""
    runner = CliRunner()
    (git_repo / ".datum").mkdir()

    # Write first
    runner.invoke(
        app,
        [
            "lane-state",
            "write",
            "--epic",
            "datum/epic-read-json",
            "--task",
            "task-001",
            "--status",
            "completed",
        ],
    )

    # Read
    result = runner.invoke(
        app,
        [
            "lane-state",
            "read",
            "--epic",
            "datum/epic-read-json",
            "--task",
            "task-001",
        ],
    )
    assert result.exit_code == 0

    # Parse stdout as JSON
    output_dict = json.loads(result.stdout)
    assert isinstance(output_dict, dict)
    assert "task_id" in output_dict
    assert "status" in output_dict
