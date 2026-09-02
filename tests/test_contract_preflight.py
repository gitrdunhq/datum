"""Regression tests for #356: a RED test that contradicts an existing contract
(e.g. constructs a dataclass without a required field that lives in a file
GREEN cannot write) must be caught at RED time, and a GREEN failure of the
same shape must be classified as blocked instead of blindly retried."""

import json
import subprocess
import sys
import textwrap

import pytest

from datum.contract_preflight import (
    classify_conflicts,
    find_symbol_definitions,
    parse_pytest_output,
    pytest_runner_from_test_command,
    run_contract_preflight,
    symbol_from_type_error,
)

SHORT_TB = textwrap.dedent(
    """\
    ____________________________ test_construct ____________________________
    tests/test_tool.py:7: in test_construct
        ToolResult(exit_code=0, stdout="x")
    E   TypeError: ToolResult.__init__() missing 1 required positional argument: 'stderr'
    ______________________________ test_missing ______________________________
    tests/test_tool.py:11: in test_missing
        tool.missing_fn()
    E   AttributeError: module 'pkg.tool' has no attribute 'missing_fn'
    ______________________________ test_inside _______________________________
    tests/test_tool.py:15: in test_inside
        run()
    pkg/tool.py:12: in run
        return {}.missing
    E   AttributeError: 'dict' object has no attribute 'missing'
    ______________________________ test_assert _______________________________
    tests/test_tool.py:19: in test_assert
        assert 1 == 2
    E   assert 1 == 2
    4 failed in 0.05s
    """
)


class TestParsePytestOutput:
    def test_extracts_one_failure_per_section_with_frames(self):
        failures = parse_pytest_output(SHORT_TB)
        assert [f.test for f in failures] == [
            "test_construct",
            "test_missing",
            "test_inside",
            "test_assert",
        ]
        first = failures[0]
        assert first.error_type == "TypeError"
        assert "missing 1 required positional argument" in first.message
        assert first.frames == [("tests/test_tool.py", 7, "test_construct")]
        assert first.origin_file == "tests/test_tool.py"

    def test_origin_is_the_innermost_frame(self):
        inside = parse_pytest_output(SHORT_TB)[2]
        assert inside.error_type == "AttributeError"
        assert inside.origin_file == "pkg/tool.py"

    def test_plain_assertion_has_no_error_type(self):
        assert parse_pytest_output(SHORT_TB)[3].error_type is None

    def test_empty_output_gives_no_failures(self):
        assert parse_pytest_output("") == []


class TestSymbolFromTypeError:
    @pytest.mark.parametrize(
        "msg,expected",
        [
            ("ToolResult.__init__() missing 1 required positional argument: 'stderr'", "ToolResult"),
            ("run() got an unexpected keyword argument 'x'", "run"),
            ("Config() takes no arguments", "Config"),
            ("run() takes 1 positional argument but 2 were given", "run"),
            ("'NoneType' object is not callable", None),
        ],
    )
    def test_symbol(self, msg, expected):
        assert symbol_from_type_error(msg) == expected


class TestPytestRunnerFromTestCommand:
    def test_uv_run_pytest(self):
        assert pytest_runner_from_test_command("uv run pytest -x -q") == ["uv", "run", "pytest"]

    def test_container_command_keeps_prefix_up_to_pytest(self):
        cmd = "podman run --rm -v .:/w img pytest -q tests"
        assert pytest_runner_from_test_command(cmd) == [
            "podman", "run", "--rm", "-v", ".:/w", "img", "pytest",
        ]

    def test_non_pytest_command_is_none(self):
        assert pytest_runner_from_test_command("npx vitest run") is None


@pytest.fixture
def repo(tmp_path):
    (tmp_path / "pkg").mkdir()
    (tmp_path / "pkg" / "__init__.py").write_text("")
    (tmp_path / "pkg" / "tool.py").write_text(
        textwrap.dedent(
            """\
            from dataclasses import dataclass


            @dataclass
            class ToolResult:
                exit_code: int
                stdout: str
                stderr: str


            def run():
                return {}.missing
            """
        )
    )
    (tmp_path / "pkg" / "other.py").write_text("")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "__init__.py").write_text("")
    (tmp_path / "tests" / "test_tool.py").write_text(
        textwrap.dedent(
            """\
            from pkg import tool
            from pkg.tool import ToolResult, run


            def test_construct():
                assert ToolResult(exit_code=0, stdout="x").exit_code == 0


            def test_missing():
                assert tool.missing_fn() == 1


            def test_inside():
                assert run() == 1
            """
        )
    )
    return tmp_path


class TestFindSymbolDefinitions:
    def test_finds_class_in_repo(self, repo):
        assert find_symbol_definitions(repo, "ToolResult") == ["pkg/tool.py"]

    def test_unknown_symbol_is_empty(self, repo):
        assert find_symbol_definitions(repo, "missing_fn") == []


class TestClassifyConflicts:
    def _failures(self):
        return parse_pytest_output(SHORT_TB)

    def test_signature_mismatch_against_unwritable_contract(self, repo):
        conflicts = classify_conflicts(
            self._failures(),
            repo,
            test_files=["tests/test_tool.py"],
            allowed_files=["pkg/other.py"],
        )
        kinds = {c["test"]: c for c in conflicts}
        assert kinds["test_construct"]["kind"] == "signature_mismatch"
        assert kinds["test_construct"]["symbol"] == "ToolResult"
        assert kinds["test_construct"]["defined_in"] == ["pkg/tool.py"]
        assert kinds["test_inside"]["kind"] == "raised_in_unwritable_file"
        assert kinds["test_inside"]["defined_in"] == ["pkg/tool.py"]
        # A missing attribute is the normal RED signal, never a conflict.
        assert "test_missing" not in kinds
        assert "test_assert" not in kinds

    def test_no_conflict_when_green_can_write_the_contract(self, repo):
        conflicts = classify_conflicts(
            self._failures(),
            repo,
            test_files=["tests/test_tool.py"],
            allowed_files=["pkg/tool.py"],
        )
        assert conflicts == []

    def test_directory_shaped_allowed_entry_covers_nested_file(self, repo):
        conflicts = classify_conflicts(
            self._failures(),
            repo,
            test_files=["tests/test_tool.py"],
            allowed_files=["pkg"],
        )
        assert conflicts == []


class TestRunContractPreflight:
    def test_end_to_end_reports_conflict(self, repo):
        result = run_contract_preflight(
            repo,
            test_files=["tests/test_tool.py"],
            allowed_files=["pkg/other.py"],
            test_command=f"{sys.executable} -m pytest -q",
        )
        assert result["status"] == "contract_conflict"
        assert {c["symbol"] for c in result["conflicts"] if c["symbol"]} == {"ToolResult"}
        assert result["needs_write"] == ["pkg/tool.py"]
        assert result["pytest_exit_code"] != 0

    def test_end_to_end_ok_when_contract_is_writable(self, repo):
        result = run_contract_preflight(
            repo,
            test_files=["tests/test_tool.py"],
            allowed_files=["pkg/tool.py"],
            test_command=f"{sys.executable} -m pytest -q",
        )
        assert result["status"] == "ok"
        assert result["needs_write"] == []

    def test_skipped_for_non_pytest_lane(self, repo):
        result = run_contract_preflight(
            repo,
            test_files=["tests/test_tool.py"],
            allowed_files=["pkg/tool.py"],
            test_command="npx vitest run",
        )
        assert result["status"] == "skipped"
        assert "pytest" in result["reason"]

    def test_cli_exits_nonzero_on_conflict_and_prints_json(self, repo):
        proc = subprocess.run(
            [
                sys.executable, "-m", "datum.contract_preflight",
                "--repo", str(repo),
                "--test-file", "tests/test_tool.py",
                "--allowed", "pkg/other.py",
                "--test-command", f"{sys.executable} -m pytest -q",
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        assert proc.returncode == 1, proc.stderr
        payload = json.loads(proc.stdout)
        assert payload["status"] == "contract_conflict"
