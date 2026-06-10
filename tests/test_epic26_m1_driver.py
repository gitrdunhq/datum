"""Structural tests for the M1 driver script template (task-007).

These tests validate that the driver template:
1. Exists at the expected path
2. Is valid Python (AST-parseable)
3. Imports datum.local_llm (run_phase or multi_turn_phase)
4. Defines main() or has if __name__ == "__main__"
5. Has structured failure output (json.dumps or FailureReport or similar)
6. Does NOT import anthropic, does NOT contain "claude" (strictly-local)
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent
    / "docs"
    / "epics"
    / "datum"
    / "epic-26"
    / "bootstrap"
    / "templates"
    / "m1_driver.py"
)


class TestM1DriverTemplateExists:
    """The template file must exist at the canonical path."""

    def test_template_file_exists(self):
        assert (
            TEMPLATE_PATH.exists()
        ), f"M1 driver template not found at {TEMPLATE_PATH}"


class TestM1DriverValidPython:
    """Template must be valid, parseable Python."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    def test_ast_parseable(self, source: str):
        try:
            ast.parse(source, filename=str(TEMPLATE_PATH))
        except SyntaxError as e:
            pytest.fail(f"Template has a syntax error: {e}")


class TestM1DriverImports:
    """Template must import datum.local_llm and must NOT import anthropic."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    def test_imports_datum_local_llm(self, source: str):
        assert "datum.local_llm" in source, (
            "Template must import from datum.local_llm "
            "(run_phase or multi_turn_phase)"
        )

    def test_imports_multi_turn_phase(self, source: str):
        assert (
            "multi_turn_phase" in source
        ), "Template must call multi_turn_phase for the RED-GREEN loop"

    def test_no_anthropic_import(self, source: str):
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    assert (
                        "anthropic" not in alias.name.lower()
                    ), f"Template must not import anthropic: {alias.name}"
            elif isinstance(node, ast.ImportFrom):
                if node.module and "anthropic" in node.module.lower():
                    pytest.fail(
                        f"Template must not import from anthropic: {node.module}"
                    )

    def test_no_claude_reference(self, source: str):
        lowered = source.lower()
        # Allow "claude" only in comments that disclaim it (e.g. "no claude")
        # but reject any usage that looks like a model ID or API call
        lines = lowered.splitlines()
        for i, line in enumerate(lines, 1):
            stripped = line.lstrip()
            # skip comment-only lines
            if stripped.startswith("#"):
                continue
            assert "claude" not in stripped, (
                f"Line {i} contains 'claude' in non-comment code. "
                f"The driver must be strictly local."
            )


class TestM1DriverEntryPoint:
    """Template must have a main() function or if __name__ == '__main__' block."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    @pytest.fixture
    def tree(self, source: str) -> ast.Module:
        return ast.parse(source)

    def test_has_main_function(self, tree: ast.Module):
        func_names = [
            node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
        ]
        assert "main" in func_names, "Template must define a main() function"

    def test_has_name_main_guard(self, source: str):
        assert (
            "__name__" in source and "__main__" in source
        ), "Template must have an if __name__ == '__main__' block"


class TestM1DriverFailureOutput:
    """Template must have structured failure output mechanism."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    def test_has_json_dumps(self, source: str):
        assert (
            "json.dumps" in source or "json.dump" in source
        ), "Template must use json.dumps/json.dump for structured failure output"

    def test_has_failure_record_concept(self, source: str):
        lowered = source.lower()
        has_failure_concept = any(
            term in lowered for term in ["failure", "fail_record", "failure_record"]
        )
        assert has_failure_concept, (
            "Template must reference a structured failure record "
            "(FailureReport, failure_record, or similar)"
        )
