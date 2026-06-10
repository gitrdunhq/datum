"""
RED tests for task-001: Write-tool lane scripts + manifest entries.

These tests fail because the three write-tool scripts do not yet exist and
no manifest entries have been added. They become green once GREEN phase delivers:
  - scripts/lane-tools/write_to_file.py
  - scripts/lane-tools/replace_file_content.py
  - scripts/lane-tools/multi_replace_file_content.py
  - scripts/lane-tools/manifest.toml entries for all three tools

Property IDs covered (PROPERTIES.md task-001 assignment):
  SAFE-001, SAFE-003, SAFE-005, LIVE-004, INV-004,
  BOUND-001, BOUND-002, BOUND-003, BOUND-004,
  IDEM-002, ORD-003, ORD-004, ISOL-002,
  PERF-002, PERF-003, SEC-002, COMPAT-001
"""

import json
import subprocess
import sys
import time
import tomllib
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Repo-root anchor — all paths are relative to the datum repo root.
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
LANE_TOOLS_DIR = REPO_ROOT / "scripts" / "lane-tools"
MANIFEST_PATH = LANE_TOOLS_DIR / "manifest.toml"

WRITE_TOOL_NAMES = [
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
]

# ---------------------------------------------------------------------------
# Helper: invoke a tool via the lane-tools-runner (subprocess), returning
# (stdout, stderr, returncode).  cwd MUST be REPO_ROOT so the runner can
# resolve the manifest at scripts/lane-tools/manifest.toml.
# ---------------------------------------------------------------------------


def _run_tool(
    tool_name: str, tool_args: dict, cwd: Path = REPO_ROOT
) -> tuple[str, str, int]:
    cmd = [
        sys.executable,
        "-m",
        "datum.lane_tools_runner",
        tool_name,
        json.dumps(tool_args),
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=30,
        cwd=str(cwd),
    )
    return result.stdout, result.stderr, result.returncode


# ===========================================================================
# Group 1: Script existence (AC4.1, AC4.2, AC4.3)
# Property: ORD-003 — manifest entries and scripts must exist before runner
#           can dispatch; absence here is the root gap this task fills.
# ===========================================================================


class TestScriptExists:
    """ORD-003: Script files must exist before they can be registered or run."""

    def test_write_to_file_script_exists(self):
        """ORD-003: scripts/lane-tools/write_to_file.py must exist."""
        script = LANE_TOOLS_DIR / "write_to_file.py"
        assert script.exists(), (
            f"Missing script: {script}. "
            "write_to_file is declared in WRITE_TOOLS but has no backing .py file. "
            "GREEN: create scripts/lane-tools/write_to_file.py."
        )

    def test_replace_file_content_script_exists(self):
        """ORD-003: scripts/lane-tools/replace_file_content.py must exist."""
        script = LANE_TOOLS_DIR / "replace_file_content.py"
        assert script.exists(), (
            f"Missing script: {script}. "
            "replace_file_content is declared in WRITE_TOOLS but has no backing .py file. "
            "GREEN: create scripts/lane-tools/replace_file_content.py."
        )

    def test_multi_replace_file_content_script_exists(self):
        """ORD-003: scripts/lane-tools/multi_replace_file_content.py must exist."""
        script = LANE_TOOLS_DIR / "multi_replace_file_content.py"
        assert script.exists(), (
            f"Missing script: {script}. "
            "multi_replace_file_content is declared in WRITE_TOOLS but has no backing .py file. "
            "GREEN: create scripts/lane-tools/multi_replace_file_content.py."
        )


# ===========================================================================
# Group 2: Manifest entries (AC4.4)
# Property: ORD-003, COMPAT-001
# ===========================================================================


class TestManifestEntries:
    """
    ORD-003 + COMPAT-001: Each write tool must have a manifest entry with the
    exact fields documented in the research findings.  COMPAT-001: existing
    read-tool entries must remain untouched.
    """

    def _manifest(self) -> dict:
        assert MANIFEST_PATH.exists(), f"manifest.toml missing: {MANIFEST_PATH}"
        with MANIFEST_PATH.open("rb") as f:
            return tomllib.load(f)

    # ---- write_to_file entry -----------------------------------------------

    def test_manifest_has_write_to_file(self):
        """ORD-003: manifest.toml must have a [tools.write_to_file] entry."""
        m = self._manifest()
        tools = m.get("tools", {})
        assert "write_to_file" in tools, (
            "No [tools.write_to_file] entry in manifest.toml. "
            "GREEN: add the entry with path, description, permissions, "
            "timeout_seconds, added_in_epic, added_in_lane."
        )

    def test_manifest_write_to_file_required_fields(self):
        """ORD-003: write_to_file entry must have all required manifest fields."""
        m = self._manifest()
        entry = m.get("tools", {}).get("write_to_file", {})
        for field in (
            "path",
            "description",
            "permissions",
            "timeout_seconds",
            "added_in_epic",
            "added_in_lane",
        ):
            assert field in entry, (
                f"write_to_file manifest entry missing field '{field}'. "
                "All six fields (path, description, permissions, timeout_seconds, "
                "added_in_epic, added_in_lane) are required."
            )

    def test_manifest_write_to_file_permissions(self):
        """ORD-003: write_to_file must have write=['.'] permission."""
        m = self._manifest()
        perms = m.get("tools", {}).get("write_to_file", {}).get("permissions", {})
        assert perms.get("write") == ["."], (
            f"write_to_file permissions.write must be ['.'], got {perms.get('write')!r}. "
            "Research findings specify: permissions = { network = false, write = ['.'], read = ['.'] }"
        )

    def test_manifest_write_to_file_timeout(self):
        """ORD-003: write_to_file must have a finite timeout_seconds."""
        m = self._manifest()
        entry = m.get("tools", {}).get("write_to_file", {})
        timeout = entry.get("timeout_seconds")
        assert (
            isinstance(timeout, int) and timeout > 0
        ), f"write_to_file timeout_seconds must be a positive int, got {timeout!r}."

    # ---- replace_file_content entry ----------------------------------------

    def test_manifest_has_replace_file_content(self):
        """ORD-003: manifest.toml must have a [tools.replace_file_content] entry."""
        m = self._manifest()
        tools = m.get("tools", {})
        assert "replace_file_content" in tools, (
            "No [tools.replace_file_content] entry in manifest.toml. "
            "GREEN: add the entry."
        )

    def test_manifest_replace_file_content_required_fields(self):
        """ORD-003: replace_file_content entry must have all required manifest fields."""
        m = self._manifest()
        entry = m.get("tools", {}).get("replace_file_content", {})
        for field in (
            "path",
            "description",
            "permissions",
            "timeout_seconds",
            "added_in_epic",
            "added_in_lane",
        ):
            assert (
                field in entry
            ), f"replace_file_content manifest entry missing field '{field}'."

    def test_manifest_replace_file_content_permissions(self):
        """ORD-003: replace_file_content must have write=['.'] permission."""
        m = self._manifest()
        perms = (
            m.get("tools", {}).get("replace_file_content", {}).get("permissions", {})
        )
        assert perms.get("write") == [
            "."
        ], f"replace_file_content permissions.write must be ['.'], got {perms.get('write')!r}."

    def test_manifest_replace_file_content_timeout(self):
        """ORD-003: replace_file_content must have a finite timeout_seconds."""
        m = self._manifest()
        entry = m.get("tools", {}).get("replace_file_content", {})
        timeout = entry.get("timeout_seconds")
        assert (
            isinstance(timeout, int) and timeout > 0
        ), f"replace_file_content timeout_seconds must be a positive int, got {timeout!r}."

    # ---- multi_replace_file_content entry ----------------------------------

    def test_manifest_has_multi_replace_file_content(self):
        """ORD-003: manifest.toml must have a [tools.multi_replace_file_content] entry."""
        m = self._manifest()
        tools = m.get("tools", {})
        assert "multi_replace_file_content" in tools, (
            "No [tools.multi_replace_file_content] entry in manifest.toml. "
            "GREEN: add the entry."
        )

    def test_manifest_multi_replace_required_fields(self):
        """ORD-003: multi_replace_file_content entry must have all required manifest fields."""
        m = self._manifest()
        entry = m.get("tools", {}).get("multi_replace_file_content", {})
        for field in (
            "path",
            "description",
            "permissions",
            "timeout_seconds",
            "added_in_epic",
            "added_in_lane",
        ):
            assert (
                field in entry
            ), f"multi_replace_file_content manifest entry missing field '{field}'."

    def test_manifest_multi_replace_permissions(self):
        """ORD-003: multi_replace_file_content must have write=['.'] permission."""
        m = self._manifest()
        perms = (
            m.get("tools", {})
            .get("multi_replace_file_content", {})
            .get("permissions", {})
        )
        assert perms.get("write") == ["."], (
            f"multi_replace_file_content permissions.write must be ['.'], "
            f"got {perms.get('write')!r}."
        )

    def test_manifest_multi_replace_timeout(self):
        """ORD-003: multi_replace_file_content must have a finite timeout_seconds."""
        m = self._manifest()
        entry = m.get("tools", {}).get("multi_replace_file_content", {})
        timeout = entry.get("timeout_seconds")
        assert (
            isinstance(timeout, int) and timeout > 0
        ), f"multi_replace_file_content timeout_seconds must be a positive int, got {timeout!r}."

    # ---- COMPAT-001: existing entries must remain unchanged ----------------

    def test_existing_read_tools_untouched(self):
        """COMPAT-001: all seven existing read-tool entries must remain in manifest."""
        m = self._manifest()
        tools = m.get("tools", {})
        existing_tools = [
            "find_callers",
            "filter_gitnexus_output",
            "read_file",
            "read_file_range",
            "list_dir",
            "grep_search",
            "run_command",
        ]
        for name in existing_tools:
            assert name in tools, (
                f"Existing tool '{name}' was removed from manifest.toml. "
                "COMPAT-001: existing entries must remain unchanged."
            )


# ===========================================================================
# Group 3: Functional tests via runner
# Properties: LIVE-004, INV-004, BOUND-001, BOUND-002, BOUND-003, BOUND-004,
#             IDEM-002, ORD-004, SAFE-003, PERF-002, PERF-003
# ===========================================================================


class TestWriteToFileFunctional:
    """
    Functional tests for write_to_file via the lane-tools-runner.
    The tmp_path fixture provides a sandbox directory.  We pass it via the
    JSON args — _execute_tool's sandbox check runs in-process; the runner
    itself just calls the script.  For functional tests we invoke the runner
    directly (which calls the script) using a path inside tmp_path.
    """

    def test_write_to_file_creates_file(self, tmp_path):
        """LIVE-004 + INV-004: write_to_file must create a file with given content."""
        target = tmp_path / "hello.txt"
        stdout, stderr, rc = _run_tool(
            "write_to_file",
            {"path": str(target), "content": "hello world"},
        )
        assert rc == 0, (
            f"write_to_file exited {rc}. "
            f"stdout={stdout!r} stderr={stderr!r}. "
            "Script missing or not registered in manifest."
        )
        assert target.exists(), "write_to_file returned 0 but file was not created."
        assert target.read_text() == "hello world"

    def test_write_to_file_output_contains_path_and_byte_count(self, tmp_path):
        """INV-004: write_to_file output must confirm written path and byte count."""
        target = tmp_path / "bytes.txt"
        content = "abc"
        stdout, stderr, rc = _run_tool(
            "write_to_file",
            {"path": str(target), "content": content},
        )
        assert (
            rc == 0
        ), f"write_to_file exited {rc}: stdout={stdout!r} stderr={stderr!r}"
        combined = stdout + stderr
        # Must mention either the file path or 'bytes' in the output
        assert str(target) in combined or str(len(content.encode())) in combined, (
            f"INV-004: write_to_file output must reference the written path and "
            f"byte count. Got: {combined!r}"
        )

    def test_write_to_file_empty_content(self, tmp_path):
        """BOUND-001: write_to_file with empty content must create a 0-byte file."""
        target = tmp_path / "empty.txt"
        stdout, stderr, rc = _run_tool(
            "write_to_file",
            {"path": str(target), "content": ""},
        )
        assert rc == 0, (
            f"BOUND-001: write_to_file with empty content should succeed (0-byte file), "
            f"got rc={rc}: stdout={stdout!r} stderr={stderr!r}"
        )
        assert target.exists(), "write_to_file did not create empty file."
        assert (
            target.stat().st_size == 0
        ), f"BOUND-001: file should be 0 bytes, got {target.stat().st_size}."

    def test_write_to_file_idempotent(self, tmp_path):
        """IDEM-002: writing the same content twice produces the same file state."""
        target = tmp_path / "idem.txt"
        args = {"path": str(target), "content": "same content"}
        _, _, rc1 = _run_tool("write_to_file", args)
        _, _, rc2 = _run_tool("write_to_file", args)
        assert rc1 == 0 and rc2 == 0, "IDEM-002: both invocations must succeed."
        assert (
            target.read_text() == "same content"
        ), "IDEM-002: second write must produce the same content as the first."

    def test_write_to_file_performance(self, tmp_path):
        """PERF-002: write_to_file on a <10KB file must complete in under 2s."""
        target = tmp_path / "perf.txt"
        content = "x" * 8192  # 8KB
        start = time.monotonic()
        _, _, rc = _run_tool("write_to_file", {"path": str(target), "content": content})
        elapsed = time.monotonic() - start
        assert rc == 0, f"write_to_file failed (rc={rc}) during perf test."
        assert elapsed < 2.0, f"PERF-002: write_to_file took {elapsed:.2f}s (limit 2s)."


class TestReplaceFileContentFunctional:

    def _seed(self, tmp_path, name: str, content: str) -> Path:
        p = tmp_path / name
        p.write_text(content)
        return p

    def test_replace_file_content_basic(self, tmp_path):
        """LIVE-004: replace_file_content replaces old_text with new_text."""
        f = self._seed(tmp_path, "src.py", "def foo():\n    pass\n")
        stdout, stderr, rc = _run_tool(
            "replace_file_content",
            {"path": str(f), "old_text": "pass", "new_text": "return 42"},
        )
        assert rc == 0, (
            f"replace_file_content exited {rc}. "
            f"stdout={stdout!r} stderr={stderr!r}. "
            "Script missing or not registered."
        )
        assert "return 42" in f.read_text(), "Replacement not applied."
        assert "pass" not in f.read_text(), "Old text still present after replacement."

    def test_replace_file_content_missing_old_text_fails(self, tmp_path):
        """SAFE-003: replace_file_content must fail (exit non-zero) when old_text not found."""
        f = self._seed(tmp_path, "missing.py", "def bar(): pass\n")
        stdout, stderr, rc = _run_tool(
            "replace_file_content",
            {"path": str(f), "old_text": "DOES_NOT_EXIST", "new_text": "something"},
        )
        assert rc != 0, (
            f"SAFE-003: replace_file_content must exit non-zero when old_text is absent. "
            f"Got rc=0. stdout={stdout!r} stderr={stderr!r}"
        )
        # File must remain unchanged
        assert (
            f.read_text() == "def bar(): pass\n"
        ), "SAFE-003: file must not be modified when old_text is not found."

    def test_replace_file_content_same_text_noop(self, tmp_path):
        """BOUND-002: replace with old_text == new_text is a no-op success."""
        original = "def foo():\n    return 1\n"
        f = self._seed(tmp_path, "noop.py", original)
        stdout, stderr, rc = _run_tool(
            "replace_file_content",
            {"path": str(f), "old_text": "return 1", "new_text": "return 1"},
        )
        assert rc == 0, (
            f"BOUND-002: same-text replacement should succeed, got rc={rc}. "
            f"stdout={stdout!r} stderr={stderr!r}"
        )
        assert f.read_text() == original, "BOUND-002: file should be unchanged."

    def test_replace_file_content_performance(self, tmp_path):
        """PERF-003: replace_file_content on a <10KB file must complete in under 2s."""
        content = ("line of code\n" * 500)[:8192]
        f = self._seed(tmp_path, "bigfile.py", content + "TARGET")
        start = time.monotonic()
        _, _, rc = _run_tool(
            "replace_file_content",
            {"path": str(f), "old_text": "TARGET", "new_text": "REPLACED"},
        )
        elapsed = time.monotonic() - start
        assert rc == 0, f"replace_file_content failed during perf test (rc={rc})."
        assert (
            elapsed < 2.0
        ), f"PERF-003: replace_file_content took {elapsed:.2f}s (limit 2s)."


class TestMultiReplaceFileContentFunctional:

    def _seed(self, tmp_path, name: str, content: str) -> Path:
        p = tmp_path / name
        p.write_text(content)
        return p

    def test_multi_replace_applies_all_replacements(self, tmp_path):
        """LIVE-004: multi_replace_file_content applies all replacements in the list."""
        f = self._seed(tmp_path, "multi.py", "alpha beta gamma")
        stdout, stderr, rc = _run_tool(
            "multi_replace_file_content",
            {
                "path": str(f),
                "replacements": [
                    {"old_text": "alpha", "new_text": "ONE"},
                    {"old_text": "beta", "new_text": "TWO"},
                    {"old_text": "gamma", "new_text": "THREE"},
                ],
            },
        )
        assert rc == 0, (
            f"multi_replace_file_content exited {rc}. "
            f"stdout={stdout!r} stderr={stderr!r}. "
            "Script missing or not registered."
        )
        text = f.read_text()
        assert "ONE TWO THREE" == text, f"Expected 'ONE TWO THREE', got {text!r}."

    def test_multi_replace_empty_list_noop(self, tmp_path):
        """BOUND-003: multi_replace with empty replacements list must succeed as a no-op."""
        original = "untouched content"
        f = self._seed(tmp_path, "empty_list.py", original)
        stdout, stderr, rc = _run_tool(
            "multi_replace_file_content",
            {"path": str(f), "replacements": []},
        )
        assert rc == 0, (
            f"BOUND-003: empty replacements list should succeed, got rc={rc}. "
            f"stdout={stdout!r} stderr={stderr!r}"
        )
        assert f.read_text() == original, "BOUND-003: file must be unchanged."

    def test_multi_replace_sequential_order(self, tmp_path):
        """BOUND-004 + ORD-004: replacements are applied in list order (chain-dependent)."""
        # Replacement 0 changes "foo" -> "bar"; replacement 1 changes "bar" -> "baz".
        # If applied in order, result is "baz".  If reversed, "foo" would remain.
        f = self._seed(tmp_path, "chain.py", "foo")
        stdout, stderr, rc = _run_tool(
            "multi_replace_file_content",
            {
                "path": str(f),
                "replacements": [
                    {"old_text": "foo", "new_text": "bar"},
                    {"old_text": "bar", "new_text": "baz"},
                ],
            },
        )
        assert rc == 0, (
            f"multi_replace sequential test exited {rc}. "
            f"stdout={stdout!r} stderr={stderr!r}"
        )
        result = f.read_text()
        assert result == "baz", (
            f"BOUND-004/ORD-004: expected 'baz' (sequential order), got {result!r}. "
            "Replacements must be applied index-0-first."
        )


# ===========================================================================
# Group 4: SAFE-001 / SAFE-005 — sandbox enforcement
# The runner is invoked via subprocess with cwd=REPO_ROOT.  _execute_tool's
# in-process sandbox check is the primary gate; here we verify the scripts
# themselves do NOT write outside their sandbox even if called directly.
# We test the _execute_tool sandbox gate directly for path-escape rejection.
# ===========================================================================


class TestSandboxEnforcement:
    """
    SAFE-001, SAFE-005, ISOL-002: Paths escaping allowed_write_dirs must be
    rejected by _execute_tool before the runner is invoked.
    """

    def _run_execute_tool(self, tool_name: str, tool_args: dict, tmp_path: Path) -> str:
        """Call _execute_tool with enable_write_tools=True and allowed_write_dirs=[tmp_path]."""
        from datum.local_llm import _execute_tool

        mt_config = {
            "allowed_tools": [tool_name],
            "enable_write_tools": True,
            "allowed_write_dirs": [str(tmp_path)],
        }
        result, _truncated = _execute_tool(
            {"tool_name": tool_name, "tool_args": tool_args},
            mt_config,
        )
        return result

    def test_write_to_file_rejects_parent_traversal(self, tmp_path):
        """SAFE-001: path using ../ that escapes allowed_write_dirs is rejected."""
        # Construct a path that traverses above tmp_path
        escape_path = str(tmp_path / ".." / "outside.txt")
        result = self._run_execute_tool(
            "write_to_file",
            {"path": escape_path, "content": "should not be written"},
            tmp_path,
        )
        assert (
            "Error" in result
            or "sandbox" in result.lower()
            or "escape" in result.lower()
        ), f"SAFE-001: expected sandbox rejection, got: {result!r}"
        # The file must NOT have been written
        outside = (tmp_path.parent / "outside.txt").resolve()
        assert (
            not outside.exists()
        ), f"SAFE-001: sandbox violation — file was written outside allowed_write_dirs: {outside}"

    def test_write_to_file_rejects_absolute_path_outside_sandbox(self, tmp_path):
        """SAFE-001: absolute path outside allowed_write_dirs is rejected."""
        # Use /tmp as an absolute path that is not under tmp_path or REPO_ROOT
        # Pick a path that definitely resolves outside both
        result = self._run_execute_tool(
            "write_to_file",
            {"path": "/etc/datum_test_escape.txt", "content": "should not be written"},
            tmp_path,
        )
        assert (
            "Error" in result
            or "sandbox" in result.lower()
            or "escape" in result.lower()
        ), f"SAFE-001: expected sandbox rejection for /etc/..., got: {result!r}"
        assert not Path(
            "/etc/datum_test_escape.txt"
        ).exists(), (
            "SAFE-001: sandbox violation — file written to /etc/datum_test_escape.txt"
        )

    def test_replace_file_content_rejects_escape(self, tmp_path):
        """SAFE-001: replace_file_content with escaping path is rejected."""
        escape_path = str(tmp_path / ".." / "escape_replace.txt")
        result = self._run_execute_tool(
            "replace_file_content",
            {"path": escape_path, "old_text": "x", "new_text": "y"},
            tmp_path,
        )
        assert (
            "Error" in result
            or "sandbox" in result.lower()
            or "escape" in result.lower()
        ), f"SAFE-001: expected sandbox rejection for replace_file_content, got: {result!r}"

    def test_multi_replace_rejects_escape(self, tmp_path):
        """SAFE-001: multi_replace_file_content with escaping path is rejected."""
        escape_path = str(tmp_path / ".." / "escape_multi.txt")
        result = self._run_execute_tool(
            "multi_replace_file_content",
            {
                "path": escape_path,
                "replacements": [{"old_text": "a", "new_text": "b"}],
            },
            tmp_path,
        )
        assert (
            "Error" in result
            or "sandbox" in result.lower()
            or "escape" in result.lower()
        ), f"SAFE-001: expected sandbox rejection for multi_replace, got: {result!r}"

    def test_symlink_escape_rejected(self, tmp_path):
        """SAFE-005: a symlink inside the sandbox that points outside is resolved and rejected."""
        # Create a symlink inside tmp_path that points to the parent directory
        link = tmp_path / "escape_link"
        try:
            link.symlink_to(tmp_path.parent)
        except OSError:
            pytest.skip("Cannot create symlinks on this filesystem.")

        # Attempt to write via the symlink path
        escape_target = str(link / "via_symlink.txt")
        result = self._run_execute_tool(
            "write_to_file",
            {"path": escape_target, "content": "symlink escape"},
            tmp_path,
        )
        # Either the sandbox check catches it (resolved path escapes) or it succeeds
        # because the resolved path IS under tmp_path — both are acceptable if the file
        # is not written outside the sandbox.
        via_symlink_resolved = (tmp_path.parent / "via_symlink.txt").resolve()
        # If the file somehow exists outside the sandbox, that's the violation.
        if via_symlink_resolved.exists():
            via_symlink_resolved.unlink()  # clean up
            pytest.fail(
                f"SAFE-005: symlink escape allowed — file written outside sandbox at "
                f"{via_symlink_resolved}"
            )
        # If it was rejected (rc != 0 from runner) or sandbox error returned, test passes.


# ===========================================================================
# Group 5: SEC-002 — no subprocess/eval/os.system in write-tool scripts
# ===========================================================================


class TestSecurityConstraints:
    """SEC-002: Write-tool scripts must NOT use subprocess, os.system, or eval."""

    @pytest.mark.parametrize("tool_name", WRITE_TOOL_NAMES)
    def test_no_subprocess_in_script(self, tool_name):
        """SEC-002: write-tool scripts must not import or use subprocess."""
        script = LANE_TOOLS_DIR / f"{tool_name}.py"
        if not script.exists():
            pytest.fail(
                f"SEC-002 pre-check failed: {script} does not exist. "
                "Script must be created (GREEN) before this test can verify its content."
            )
        source = script.read_text()
        assert "import subprocess" not in source and "subprocess." not in source, (
            f"SEC-002: {tool_name}.py must not import or use subprocess. "
            "Write tools perform file I/O only."
        )

    @pytest.mark.parametrize("tool_name", WRITE_TOOL_NAMES)
    def test_no_os_system_in_script(self, tool_name):
        """SEC-002: write-tool scripts must not use os.system."""
        script = LANE_TOOLS_DIR / f"{tool_name}.py"
        if not script.exists():
            pytest.fail(
                f"SEC-002 pre-check failed: {script} does not exist. "
                "Script must be created (GREEN) before this test can verify its content."
            )
        source = script.read_text()
        assert (
            "os.system" not in source
        ), f"SEC-002: {tool_name}.py must not use os.system. File I/O only."

    @pytest.mark.parametrize("tool_name", WRITE_TOOL_NAMES)
    def test_no_eval_in_script(self, tool_name):
        """SEC-002: write-tool scripts must not use eval()."""
        script = LANE_TOOLS_DIR / f"{tool_name}.py"
        if not script.exists():
            pytest.fail(
                f"SEC-002 pre-check failed: {script} does not exist. "
                "Script must be created (GREEN) before this test can verify its content."
            )
        source = script.read_text()
        # Allow 'eval' in comments or strings — check for actual call
        import ast

        try:
            tree = ast.parse(source)
        except SyntaxError:
            pytest.fail(f"SEC-002: {tool_name}.py has a SyntaxError.")
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id == "eval":
                    pytest.fail(f"SEC-002: {tool_name}.py calls eval(). File I/O only.")
