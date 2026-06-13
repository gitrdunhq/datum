"""
Integration tests for task-002: Write-tool _execute_tool end-to-end.

Exercises datum.local_llm._execute_tool directly (in-process Python API) with
the three new write-tool scripts.  All file I/O lands in pytest tmp_path via
absolute paths + allowed_write_dirs so no repo files are touched.

Property IDs covered (PROPERTIES.md task-002 assignment):
  SAFE-001, SAFE-003, SAFE-005, LIVE-004,
  BOUND-001, BOUND-002, BOUND-003, BOUND-004,
  IDEM-002, ORD-003, ISOL-002,
  PERF-002, PERF-003, OBS-003, COMPAT-002
"""

import time
from pathlib import Path

from datum.local_llm import _execute_tool

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

WRITE_TOOLS = {"write_to_file", "replace_file_content", "multi_replace_file_content"}


def _config(tmp_path: Path, extra_tools: list[str] | None = None) -> dict:
    """Return a minimal mt_config with write tools enabled for tmp_path."""
    tools = list(WRITE_TOOLS) + (extra_tools or [])
    return {
        "allowed_tools": tools,
        "enable_write_tools": True,
        "allowed_write_dirs": [str(tmp_path)],
    }


def _tc(tool_name: str, tool_args: dict) -> dict:
    """Build a plain tool_call dict (mirrors ToolCall schema)."""
    return {"tool_name": tool_name, "tool_args": tool_args}


# ===========================================================================
# Group 1 — write_to_file happy path (AC4.5, LIVE-004, INV-004)
# ===========================================================================


class TestWriteToFile:
    """LIVE-004, INV-004, PERF-002 — write_to_file end-to-end success."""

    def test_creates_file_with_exact_content(self, tmp_path):
        """AC4.5: write_to_file succeeds; file exists with exact content."""
        target = tmp_path / "hello.txt"
        result, was_truncated = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "hello world"}),
            _config(tmp_path),
        )
        assert isinstance(result, str), "result must be str"
        assert isinstance(was_truncated, bool), "second element must be bool"
        assert target.exists(), f"Expected {target} to be created"
        assert target.read_text(encoding="utf-8") == "hello world"
        # INV-004: confirmation must mention path and byte count
        assert (
            "ok" in result.lower() or str(target) in result
        ), f"Result should confirm path: {result!r}"

    def test_creates_nested_directories(self, tmp_path):
        """write_to_file must create parent directories as needed."""
        target = tmp_path / "deep" / "nested" / "file.txt"
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "nested"}),
            _config(tmp_path),
        )
        assert target.exists()
        assert target.read_text() == "nested"

    def test_creates_python_file(self, tmp_path):
        """write_to_file handles .py extension (sandbox path check fires on .py)."""
        target = tmp_path / "module.py"
        code = "def foo():\n    return 42\n"
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": code}),
            _config(tmp_path),
        )
        assert target.exists()
        assert target.read_text() == code

    # BOUND-001
    def test_empty_content_creates_zero_byte_file(self, tmp_path):
        """BOUND-001: empty string content must create an empty file, not error."""
        target = tmp_path / "empty.txt"
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": ""}),
            _config(tmp_path),
        )
        assert target.exists(), "empty-content write_to_file must create the file"
        assert target.stat().st_size == 0, "file must be 0 bytes"
        assert "Error" not in result

    # IDEM-002
    def test_idempotent_same_content(self, tmp_path):
        """IDEM-002: writing the same path+content twice produces identical file state."""
        target = tmp_path / "idem.txt"
        cfg = _config(tmp_path)
        tc = _tc("write_to_file", {"path": str(target), "content": "same"})
        _execute_tool(tc, cfg)
        _execute_tool(tc, cfg)
        assert target.read_text() == "same"

    # PERF-002
    def test_completes_under_two_seconds_small_file(self, tmp_path):
        """PERF-002: write_to_file for < 10KB must complete in under 2 seconds."""
        target = tmp_path / "perf.txt"
        content = "x" * 9000  # ~9 KB
        start = time.monotonic()
        _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": content}),
            _config(tmp_path),
        )
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, f"write_to_file took {elapsed:.2f}s (limit: 2s)"


# ===========================================================================
# Group 2 — replace_file_content (AC4.5 extension, SAFE-003, BOUND-002, PERF-003)
# ===========================================================================


class TestReplaceFileContent:
    """replace_file_content end-to-end."""

    def _make_file(self, tmp_path: Path, name: str, content: str) -> Path:
        p = tmp_path / name
        p.write_text(content, encoding="utf-8")
        return p

    def test_replaces_text_in_file(self, tmp_path):
        """AC4.5: replace_file_content modifies the file with the new text."""
        f = self._make_file(tmp_path, "replace.txt", "foo bar baz")
        result, was_truncated = _execute_tool(
            _tc(
                "replace_file_content",
                {"path": str(f), "old_text": "bar", "new_text": "QUX"},
            ),
            _config(tmp_path),
        )
        assert isinstance(result, str)
        assert isinstance(was_truncated, bool)
        assert f.read_text() == "foo QUX baz"
        assert "Error" not in result

    # SAFE-003
    def test_error_when_old_text_not_found(self, tmp_path):
        """SAFE-003: replace_file_content must NOT silently succeed when old_text absent."""
        f = self._make_file(tmp_path, "no_match.txt", "alpha beta gamma")
        result, _ = _execute_tool(
            _tc(
                "replace_file_content",
                {"path": str(f), "old_text": "NOTHERE", "new_text": "X"},
            ),
            _config(tmp_path),
        )
        # Result must mention an error; file must be unchanged
        assert (
            "Error" in result or "error" in result
        ), f"Expected error for missing old_text, got: {result!r}"
        assert f.read_text() == "alpha beta gamma", "File must not be modified"

    # BOUND-002
    def test_same_text_is_noop(self, tmp_path):
        """BOUND-002: old_text == new_text must succeed as a no-op."""
        original = "hello world"
        f = self._make_file(tmp_path, "noop.txt", original)
        result, _ = _execute_tool(
            _tc(
                "replace_file_content",
                {"path": str(f), "old_text": "hello", "new_text": "hello"},
            ),
            _config(tmp_path),
        )
        assert "Error" not in result
        assert f.read_text() == original

    def test_replaces_only_first_occurrence(self, tmp_path):
        """replace_file_content replaces exactly the first match."""
        f = self._make_file(tmp_path, "multi.txt", "a a a")
        _execute_tool(
            _tc(
                "replace_file_content",
                {"path": str(f), "old_text": "a", "new_text": "Z"},
            ),
            _config(tmp_path),
        )
        assert f.read_text() == "Z a a"

    # PERF-003
    def test_completes_under_two_seconds_small_file(self, tmp_path):
        """PERF-003: replace_file_content for < 10KB must complete in under 2 seconds."""
        content = "needle" + "x" * 8990
        f = self._make_file(tmp_path, "perf.txt", content)
        start = time.monotonic()
        _execute_tool(
            _tc(
                "replace_file_content",
                {"path": str(f), "old_text": "needle", "new_text": "PIN"},
            ),
            _config(tmp_path),
        )
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, f"replace_file_content took {elapsed:.2f}s (limit: 2s)"


# ===========================================================================
# Group 3 — multi_replace_file_content (AC4.5 extension, BOUND-003, BOUND-004)
# ===========================================================================


class TestMultiReplaceFileContent:
    """multi_replace_file_content end-to-end."""

    def _make_file(self, tmp_path: Path, name: str, content: str) -> Path:
        p = tmp_path / name
        p.write_text(content, encoding="utf-8")
        return p

    def test_applies_multiple_edits(self, tmp_path):
        """AC4.5: multi_replace applies a list of replacements and modifies the file."""
        f = self._make_file(tmp_path, "multi.txt", "alpha beta gamma")
        result, was_truncated = _execute_tool(
            _tc(
                "multi_replace_file_content",
                {
                    "path": str(f),
                    "replacements": [
                        {"old_text": "alpha", "new_text": "A"},
                        {"old_text": "beta", "new_text": "B"},
                        {"old_text": "gamma", "new_text": "G"},
                    ],
                },
            ),
            _config(tmp_path),
        )
        assert isinstance(result, str)
        assert isinstance(was_truncated, bool)
        assert f.read_text() == "A B G"
        assert "Error" not in result

    # BOUND-003
    def test_empty_replacements_list_is_noop(self, tmp_path):
        """BOUND-003: empty replacements list must succeed as a no-op."""
        original = "unchanged content"
        f = self._make_file(tmp_path, "noop.txt", original)
        result, _ = _execute_tool(
            _tc(
                "multi_replace_file_content",
                {"path": str(f), "replacements": []},
            ),
            _config(tmp_path),
        )
        assert "Error" not in result
        assert f.read_text() == original

    # BOUND-004
    def test_sequential_order_chained(self, tmp_path):
        """BOUND-004: replacements applied sequentially; later one sees result of earlier."""
        f = self._make_file(tmp_path, "order.txt", "cat")
        result, _ = _execute_tool(
            _tc(
                "multi_replace_file_content",
                {
                    "path": str(f),
                    "replacements": [
                        # step 1: cat -> bat
                        {"old_text": "cat", "new_text": "bat"},
                        # step 2: must see 'bat' (not 'cat') to succeed
                        {"old_text": "bat", "new_text": "rat"},
                    ],
                },
            ),
            _config(tmp_path),
        )
        assert "Error" not in result, f"Unexpected error: {result!r}"
        assert f.read_text() == "rat", "Sequential application must chain correctly"

    def test_error_when_replacement_text_absent(self, tmp_path):
        """multi_replace errors if any old_text is not found (same as SAFE-003 logic)."""
        f = self._make_file(tmp_path, "bad.txt", "hello world")
        result, _ = _execute_tool(
            _tc(
                "multi_replace_file_content",
                {
                    "path": str(f),
                    "replacements": [
                        {"old_text": "hello", "new_text": "hi"},
                        {"old_text": "NOTHERE", "new_text": "X"},
                    ],
                },
            ),
            _config(tmp_path),
        )
        assert "Error" in result or "error" in result


# ===========================================================================
# Group 4 — Sandbox enforcement (AC4.6, SAFE-001, SAFE-005, ISOL-002)
# ===========================================================================


class TestSandboxEnforcement:
    """AC4.6, SAFE-001, SAFE-005, ISOL-002 — paths outside allowed roots are rejected."""

    def test_relative_path_escape_rejected(self, tmp_path):
        """SAFE-001: ../escape attempt is rejected; no file written."""
        # Construct a relative path that would escape tmp_path
        # When resolved from cwd (repo root), ../escape resolves to repo parent —
        # definitely not under tmp_path or cwd.
        escape_path = str(tmp_path / ".." / "escape_attempt.txt")
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": escape_path, "content": "bad"}),
            _config(tmp_path),
        )
        # Must be an error; the escaped file must NOT exist
        assert (
            "Error" in result or "Sandbox" in result
        ), f"Expected sandbox error, got: {result!r}"
        # The resolved path would be tmp_path.parent / "escape_attempt.txt"
        escaped = (tmp_path / ".." / "escape_attempt.txt").resolve()
        assert not escaped.exists(), f"Escaped file must not be created: {escaped}"

    def test_absolute_path_outside_allowed_rejected(self, tmp_path):
        """SAFE-001/ISOL-002: absolute path outside allowed_write_dirs is rejected."""
        import tempfile

        # Use a different tmp dir that is NOT in allowed_write_dirs
        with tempfile.TemporaryDirectory() as other_dir:
            outside = Path(other_dir) / "outside.txt"
            result, _ = _execute_tool(
                _tc("write_to_file", {"path": str(outside), "content": "nope"}),
                _config(tmp_path),  # allowed_write_dirs only has tmp_path
            )
            assert (
                "Error" in result or "Sandbox" in result
            ), f"Expected sandbox rejection, got: {result!r}"
            assert not outside.exists(), "File outside sandbox must not be created"

    def test_replace_outside_sandbox_rejected(self, tmp_path):
        """SAFE-001: replace_file_content with path outside sandbox is rejected."""
        import tempfile

        with tempfile.TemporaryDirectory() as other_dir:
            outside = Path(other_dir) / "victim.txt"
            outside.write_text("original")
            result, _ = _execute_tool(
                _tc(
                    "replace_file_content",
                    {
                        "path": str(outside),
                        "old_text": "original",
                        "new_text": "hacked",
                    },
                ),
                _config(tmp_path),
            )
            assert "Error" in result or "Sandbox" in result
            # File must remain unchanged
            assert outside.read_text() == "original"

    def test_sandbox_path_check_triggers_on_slash_in_arg(self, tmp_path):
        """SAFE-005: path args containing '/' trigger sandbox resolution check."""
        # A path with / that resolves outside allowed roots must be rejected
        import tempfile

        with tempfile.TemporaryDirectory() as other:
            bad = Path(other) / "sub" / "file.txt"
            result, _ = _execute_tool(
                _tc("write_to_file", {"path": str(bad), "content": "x"}),
                _config(tmp_path),
            )
            assert "Error" in result or "Sandbox" in result


# ===========================================================================
# Group 5 — Gate: enable_write_tools=False (COMPAT-002)
# ===========================================================================


class TestWriteToolGate:
    """COMPAT-002 — write tools blocked when enable_write_tools=False."""

    def test_write_to_file_blocked_when_gate_off(self, tmp_path):
        """COMPAT-002: enable_write_tools=False must block write_to_file."""
        target = tmp_path / "blocked.txt"
        cfg = {
            "allowed_tools": list(WRITE_TOOLS),
            "enable_write_tools": False,  # gate OFF
            "allowed_write_dirs": [str(tmp_path)],
        }
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "hi"}),
            cfg,
        )
        assert (
            "blocked" in result.lower() or "Error" in result
        ), f"Expected blocked error, got: {result!r}"
        assert (
            "enable_write_tools" in result or "blocked" in result.lower()
        ), "Error message must reference the gate config key or 'blocked'"
        assert not target.exists(), "File must NOT be created when gate is off"

    def test_replace_blocked_when_gate_off(self, tmp_path):
        """COMPAT-002: enable_write_tools=False must block replace_file_content."""
        f = tmp_path / "notouch.txt"
        f.write_text("original")
        cfg = {
            "allowed_tools": list(WRITE_TOOLS),
            "enable_write_tools": False,
            "allowed_write_dirs": [str(tmp_path)],
        }
        result, _ = _execute_tool(
            _tc(
                "replace_file_content",
                {"path": str(f), "old_text": "original", "new_text": "changed"},
            ),
            cfg,
        )
        assert "blocked" in result.lower() or "Error" in result
        assert f.read_text() == "original", "File must not change when gate is off"

    def test_multi_replace_blocked_when_gate_off(self, tmp_path):
        """COMPAT-002: enable_write_tools=False must block multi_replace_file_content."""
        f = tmp_path / "notouch2.txt"
        f.write_text("alpha beta")
        cfg = {
            "allowed_tools": list(WRITE_TOOLS),
            "enable_write_tools": False,
            "allowed_write_dirs": [str(tmp_path)],
        }
        result, _ = _execute_tool(
            _tc(
                "multi_replace_file_content",
                {
                    "path": str(f),
                    "replacements": [{"old_text": "alpha", "new_text": "A"}],
                },
            ),
            cfg,
        )
        assert "blocked" in result.lower() or "Error" in result
        assert f.read_text() == "alpha beta"

    def test_gate_off_by_default_when_key_absent(self, tmp_path):
        """COMPAT-002: missing enable_write_tools key defaults to False (blocked)."""
        target = tmp_path / "default_gate.txt"
        cfg = {
            "allowed_tools": list(WRITE_TOOLS),
            # enable_write_tools intentionally absent → defaults False
            "allowed_write_dirs": [str(tmp_path)],
        }
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "x"}),
            cfg,
        )
        assert "blocked" in result.lower() or "Error" in result
        assert not target.exists()


# ===========================================================================
# Group 6 — Unknown / unregistered tool rejected (ORD-003)
# ===========================================================================


class TestUnknownTool:
    """ORD-003 — unregistered tool name is rejected before dispatch."""

    def test_unknown_tool_not_in_allowed_list(self, tmp_path):
        """ORD-003: tool not in allowed_tools list is rejected with error."""
        result, _ = _execute_tool(
            {"tool_name": "nonexistent_tool_xyz", "tool_args": {}},
            {
                "allowed_tools": list(WRITE_TOOLS),
                "enable_write_tools": True,
                "allowed_write_dirs": [str(tmp_path)],
            },
        )
        assert "Error" in result
        assert "nonexistent_tool_xyz" in result or "allowed_tools" in result

    def test_unregistered_write_tool_name(self, tmp_path):
        """ORD-003: tool not in manifest (but in allowed list) exits with runner error."""
        result, _ = _execute_tool(
            {"tool_name": "ghost_write_tool", "tool_args": {}},
            {
                "allowed_tools": ["ghost_write_tool"],
                "enable_write_tools": True,
                "allowed_write_dirs": [str(tmp_path)],
            },
        )
        # Runner exits non-zero; stdout or stderr will contain error info
        assert (
            "Error" in result or "error" in result or "unregistered" in result
        ), f"Expected error for unregistered tool, got: {result!r}"


# ===========================================================================
# Group 7 — Return shape invariant (LIVE-004, OBS-003)
# ===========================================================================


class TestReturnShape:
    """LIVE-004, OBS-003 — _execute_tool always returns (str, bool)."""

    def test_success_returns_str_bool(self, tmp_path):
        """LIVE-004: successful call returns (str, bool) tuple."""
        target = tmp_path / "shape.txt"
        ret = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "ok"}),
            _config(tmp_path),
        )
        assert isinstance(ret, tuple) and len(ret) == 2
        assert isinstance(ret[0], str)
        assert isinstance(ret[1], bool)

    def test_error_returns_str_bool(self, tmp_path):
        """LIVE-004: error paths also return (str, bool), not exceptions."""
        ret = _execute_tool(
            _tc("write_to_file", {"path": str(tmp_path / "x.txt"), "content": "x"}),
            {
                "allowed_tools": list(WRITE_TOOLS),
                "enable_write_tools": False,
                "allowed_write_dirs": [str(tmp_path)],
            },
        )
        assert isinstance(ret, tuple) and len(ret) == 2
        assert isinstance(ret[0], str)
        assert isinstance(ret[1], bool)

    def test_sandbox_violation_returns_str_bool(self, tmp_path):
        """LIVE-004: sandbox rejection also returns (str, bool)."""
        import tempfile

        with tempfile.TemporaryDirectory() as other:
            outside = Path(other) / "bad.txt"
            ret = _execute_tool(
                _tc("write_to_file", {"path": str(outside), "content": "x"}),
                _config(tmp_path),
            )
        assert isinstance(ret, tuple) and len(ret) == 2
        assert isinstance(ret[0], str)
        assert isinstance(ret[1], bool)

    def test_not_in_allowed_returns_str_bool(self):
        """LIVE-004: 'not in allowed_tools' branch returns (str, bool)."""
        ret = _execute_tool(
            {"tool_name": "write_to_file", "tool_args": {}},
            {"allowed_tools": [], "enable_write_tools": True},
        )
        assert isinstance(ret, tuple) and len(ret) == 2
        assert isinstance(ret[0], str)
        assert isinstance(ret[1], bool)


# ===========================================================================
# Group 8 — Full three-tool workflow (AC4.5 — all three in sequence)
# ===========================================================================


class TestThreeToolWorkflow:
    """AC4.5 — exercise all three write tools in the canonical create→edit→multi-edit flow."""

    def test_create_then_replace_then_multi_replace(self, tmp_path):
        """End-to-end: write → replace → multi_replace in sequence."""
        target = tmp_path / "workflow.txt"
        cfg = _config(tmp_path)

        # Step 1: create file
        r1, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "aaa bbb ccc"}),
            cfg,
        )
        assert "Error" not in r1
        assert target.read_text() == "aaa bbb ccc"

        # Step 2: replace one token
        r2, _ = _execute_tool(
            _tc(
                "replace_file_content",
                {"path": str(target), "old_text": "bbb", "new_text": "BBB"},
            ),
            cfg,
        )
        assert "Error" not in r2
        assert target.read_text() == "aaa BBB ccc"

        # Step 3: multi-replace remaining tokens
        r3, _ = _execute_tool(
            _tc(
                "multi_replace_file_content",
                {
                    "path": str(target),
                    "replacements": [
                        {"old_text": "aaa", "new_text": "A"},
                        {"old_text": "ccc", "new_text": "C"},
                    ],
                },
            ),
            cfg,
        )
        assert "Error" not in r3
        assert target.read_text() == "A BBB C"


# ===========================================================================
# Group 8 — cwd independence (agent loop chdirs into the target project)
# ===========================================================================


class TestCwdIndependence:
    """The lane-tools runner must resolve its manifest against the datum repo,
    not the process cwd — agent loops run with cwd set to the target project."""

    def test_execute_tool_works_from_foreign_cwd(self, tmp_path, monkeypatch):
        """Regression: 'Tool not in manifest' when cwd is a fixture repo."""
        monkeypatch.chdir(tmp_path)
        target = tmp_path / "out.txt"
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "from afar"}),
            _config(tmp_path),
        )
        assert "not in manifest" not in result, result
        assert target.exists(), f"Expected {target} to be created: {result}"
        assert target.read_text() == "from afar"

    def test_runner_manifest_is_absolute(self):
        from datum import lane_tools_runner

        assert lane_tools_runner.MANIFEST.is_absolute()
        assert lane_tools_runner.MANIFEST.exists()


class TestWorktreeIsolation:
    """#137: agents must only operate inside their lane's worktree.

    When worktree_path is set in mt_config:
    - the lane-tools subprocess runs with cwd=worktree_path
    - the write sandbox root is the worktree, not the datum process cwd
    - relative paths in tool_args resolve against the worktree
    """

    def _wt_config(self, worktree: Path) -> dict:
        return {
            "allowed_tools": list(WRITE_TOOLS),
            "enable_write_tools": True,
            "allowed_write_dirs": [],
            "worktree_path": str(worktree),
        }

    def test_write_lands_in_worktree_not_main_cwd(self, tmp_path, monkeypatch):
        """File written with a relative path lands in the worktree, not cwd."""
        worktree = tmp_path / "worktrees" / "lane-001"
        worktree.mkdir(parents=True)
        main_cwd = tmp_path / "main"
        main_cwd.mkdir()
        monkeypatch.chdir(main_cwd)

        result, _ = _execute_tool(
            _tc("write_to_file", {"path": "output.txt", "content": "in worktree"}),
            self._wt_config(worktree),
        )

        assert '"ok": true' in result, result
        assert (worktree / "output.txt").exists(), "file must land in worktree"
        assert not (main_cwd / "output.txt").exists(), "file must NOT land in main cwd"

    def test_sandbox_blocks_escape_from_worktree(self, tmp_path):
        """Absolute path outside the worktree is rejected even with worktree_path set."""
        worktree = tmp_path / "worktrees" / "lane-002"
        worktree.mkdir(parents=True)
        outside = tmp_path / "secret.py"

        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(outside), "content": "bad"}),
            self._wt_config(worktree),
        )

        assert "Sandbox violation" in result, result
        assert not outside.exists()

    def test_relative_path_escape_blocked_against_worktree(self, tmp_path):
        """Relative path traversal (../../escape.py) is caught against worktree root."""
        worktree = tmp_path / "worktrees" / "lane-003"
        worktree.mkdir(parents=True)

        escape = str(worktree / ".." / ".." / "escape.py")
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": escape, "content": "bad"}),
            self._wt_config(worktree),
        )

        assert "Sandbox violation" in result, result

    def test_no_worktree_path_falls_back_to_cwd(self, tmp_path, monkeypatch):
        """Omitting worktree_path preserves existing cwd-based behaviour."""
        monkeypatch.chdir(tmp_path)
        target = tmp_path / "fallback.txt"
        cfg = {
            "allowed_tools": list(WRITE_TOOLS),
            "enable_write_tools": True,
            "allowed_write_dirs": [str(tmp_path)],
        }
        result, _ = _execute_tool(
            _tc("write_to_file", {"path": str(target), "content": "fallback"}),
            cfg,
        )
        assert '"ok": true' in result, result
        assert target.read_text() == "fallback"
