"""TDD-driver preflight: abort-on-dirty working tree.

Issue #81: before an agent_loop episode begins the driver must confirm
the target repo's working tree is clean.  If uncommitted changes or
untracked files in tracked directories are present the run aborts with
a clear, actionable error listing every dirty path.

These tests mock all subprocess calls; they never touch the real repo
working tree.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest

from datum.tdd_driver import DirtyWorkingTreeError, check_clean_working_tree

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _porcelain(output: str):
    """Patch git-status --porcelain to return *output*.

    Preserves leading whitespace — porcelain lines like " M path" carry a
    meaningful leading space (unstaged modification in column Y).
    An empty or whitespace-only *output* is normalised to "" so the
    is-clean path works correctly.
    """
    # Only strip if the whole string is whitespace (the "clean tree" case).
    value = "" if not output.strip() else output
    return patch(
        "datum.tdd_driver._git_status_porcelain",
        return_value=value,
    )


# ---------------------------------------------------------------------------
# Clean tree — should pass silently
# ---------------------------------------------------------------------------


class TestCleanTree:
    def test_clean_empty_output_does_not_raise(self, tmp_path):
        with _porcelain(""):
            check_clean_working_tree(tmp_path)  # must not raise

    def test_clean_whitespace_only_does_not_raise(self, tmp_path):
        with _porcelain("   \n  "):
            check_clean_working_tree(tmp_path)  # must not raise


# ---------------------------------------------------------------------------
# Dirty tree — must raise DirtyWorkingTreeError
# ---------------------------------------------------------------------------


class TestDirtyTreeRaises:
    def test_modified_tracked_file_raises(self, tmp_path):
        with _porcelain(" M src/foo.py"):
            with pytest.raises(DirtyWorkingTreeError):
                check_clean_working_tree(tmp_path)

    def test_staged_change_raises(self, tmp_path):
        with _porcelain("M  src/bar.py"):
            with pytest.raises(DirtyWorkingTreeError):
                check_clean_working_tree(tmp_path)

    def test_untracked_file_raises(self, tmp_path):
        with _porcelain("?? new_file.py"):
            with pytest.raises(DirtyWorkingTreeError):
                check_clean_working_tree(tmp_path)

    def test_deleted_file_raises(self, tmp_path):
        with _porcelain(" D src/gone.py"):
            with pytest.raises(DirtyWorkingTreeError):
                check_clean_working_tree(tmp_path)

    def test_multiple_dirty_files_raises(self, tmp_path):
        with _porcelain(" M src/a.py\n M src/b.py\n?? scratch.py"):
            with pytest.raises(DirtyWorkingTreeError):
                check_clean_working_tree(tmp_path)


# ---------------------------------------------------------------------------
# Error message — must name the dirty files
# ---------------------------------------------------------------------------


class TestErrorMessage:
    def test_error_lists_dirty_file(self, tmp_path):
        with _porcelain(" M src/foo.py"):
            with pytest.raises(DirtyWorkingTreeError) as exc_info:
                check_clean_working_tree(tmp_path)
        assert "src/foo.py" in str(exc_info.value)

    def test_error_lists_all_dirty_files(self, tmp_path):
        with _porcelain(" M src/a.py\n?? scratch.py"):
            with pytest.raises(DirtyWorkingTreeError) as exc_info:
                check_clean_working_tree(tmp_path)
        msg = str(exc_info.value)
        assert "src/a.py" in msg
        assert "scratch.py" in msg

    def test_error_includes_human_guidance(self, tmp_path):
        """The message must tell the user what to do (commit or stash)."""
        with _porcelain(" M src/foo.py"):
            with pytest.raises(DirtyWorkingTreeError) as exc_info:
                check_clean_working_tree(tmp_path)
        msg = str(exc_info.value).lower()
        # Must mention either "commit" or "stash" as remediation advice
        assert "commit" in msg or "stash" in msg


# ---------------------------------------------------------------------------
# allow_dirty override — bypass the guard when caller explicitly opts in
# ---------------------------------------------------------------------------


class TestAllowDirtyOverride:
    def test_allow_dirty_skips_check_when_dirty(self, tmp_path):
        """allow_dirty=True must suppress the abort even when files are dirty."""
        with _porcelain(" M src/foo.py"):
            check_clean_working_tree(tmp_path, allow_dirty=True)  # must not raise

    def test_allow_dirty_false_still_raises(self, tmp_path):
        with _porcelain(" M src/foo.py"):
            with pytest.raises(DirtyWorkingTreeError):
                check_clean_working_tree(tmp_path, allow_dirty=False)


# ---------------------------------------------------------------------------
# .datum/ paths are excluded — datum's own runtime files must not trip the guard
# ---------------------------------------------------------------------------


class TestDatumDirExcluded:
    def test_datum_dir_changes_ignored(self, tmp_path):
        with _porcelain(" M .datum/runs/abc/state.json"):
            check_clean_working_tree(tmp_path)  # must not raise

    def test_datum_dir_mixed_with_real_dirty_still_raises(self, tmp_path):
        with _porcelain(" M .datum/runs/abc/state.json\n M src/real.py"):
            with pytest.raises(DirtyWorkingTreeError) as exc_info:
                check_clean_working_tree(tmp_path)
        assert "src/real.py" in str(exc_info.value)
        assert ".datum/" not in str(exc_info.value)


# ---------------------------------------------------------------------------
# repo_path parameter — the check runs against the given path, not cwd
# ---------------------------------------------------------------------------


class TestRepoDirParam:
    def test_passes_repo_path_to_git(self, tmp_path):
        captured = {}

        def fake_porcelain(path: Path) -> str:
            captured["path"] = path
            return ""

        with patch("datum.tdd_driver._git_status_porcelain", fake_porcelain):
            check_clean_working_tree(tmp_path)

        assert captured["path"] == tmp_path
