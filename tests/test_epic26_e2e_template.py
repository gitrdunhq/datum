"""Structural tests for the e2e integration test template (task-008).

These tests validate that the e2e test template:
1. Exists at the expected path
2. Is valid Python (AST-parseable)
3. Imports pytest and references m1_driver (import or subprocess call)
4. Uses pytest.mark.skipif for local-model availability check
5. Has a timeout mechanism (signal.alarm or pytest-timeout or timeout_seconds constant)
6. Does NOT contain "claude" or "anthropic" (strictly-local)
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
    / "test_m1_e2e.py"
)


class TestE2ETemplateExists:
    """The template file must exist at the canonical path."""

    def test_template_file_exists(self):
        assert TEMPLATE_PATH.exists(), f"e2e test template not found at {TEMPLATE_PATH}"


class TestE2ETemplateValidPython:
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


class TestE2ETemplateImports:
    """Template must import pytest and reference m1_driver."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    def test_imports_pytest(self, source: str):
        tree = ast.parse(source)
        has_pytest = False
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "pytest":
                        has_pytest = True
            elif isinstance(node, ast.ImportFrom):
                if node.module and node.module.startswith("pytest"):
                    has_pytest = True
        assert has_pytest, "Template must import pytest"

    def test_references_m1_driver(self, source: str):
        assert "m1_driver" in source, (
            "Template must reference m1_driver " "(via import or subprocess invocation)"
        )


class TestE2ETemplateSkipCondition:
    """Template must use pytest.mark.skipif for model availability."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    def test_has_skipif(self, source: str):
        assert "pytest.mark.skipif" in source or "skipif" in source, (
            "Template must use pytest.mark.skipif for local-model " "availability check"
        )


class TestE2ETemplateTimeout:
    """Template must have a timeout mechanism."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    def test_has_timeout_mechanism(self, source: str):
        has_timeout = any(
            term in source
            for term in [
                "signal.alarm",
                "pytest.mark.timeout",
                "timeout_seconds",
                "TIMEOUT_SECONDS",
                "timeout=",
            ]
        )
        assert has_timeout, (
            "Template must have a timeout mechanism "
            "(signal.alarm, pytest-timeout, or timeout_seconds constant)"
        )


class TestE2ETemplateStrictlyLocal:
    """Template must not contain 'claude' or 'anthropic' in non-comment code."""

    @pytest.fixture
    def source(self) -> str:
        if not TEMPLATE_PATH.exists():
            pytest.skip("template not yet written")
        return TEMPLATE_PATH.read_text()

    def test_no_claude(self, source: str):
        lowered = source.lower()
        lines = lowered.splitlines()
        for i, line in enumerate(lines, 1):
            stripped = line.lstrip()
            if stripped.startswith("#"):
                continue
            assert "claude" not in stripped, (
                f"Line {i} contains 'claude' in non-comment code. "
                "The e2e test template must be strictly local."
            )

    def test_no_anthropic(self, source: str):
        lowered = source.lower()
        lines = lowered.splitlines()
        for i, line in enumerate(lines, 1):
            stripped = line.lstrip()
            if stripped.startswith("#"):
                continue
            assert "anthropic" not in stripped, (
                f"Line {i} contains 'anthropic' in non-comment code. "
                "The e2e test template must be strictly local."
            )
