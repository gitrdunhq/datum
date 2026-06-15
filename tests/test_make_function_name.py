"""Tests for make_function_name — valid identifiers across languages (#161)."""

import re

from datum.skeleton_creator import make_function_name

VALID_PYTHON_IDENT = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]*$")


class TestMakeFunctionNamePython:
    def test_no_hyphens_in_output(self):
        name = make_function_name("AC1", "when mypy-output has error-lines", "python")
        assert "-" not in name, f"Hyphens in function name: {name}"

    def test_valid_python_identifier(self):
        name = make_function_name("AC1", "swift-test case", "python")
        assert VALID_PYTHON_IDENT.match(name), f"Invalid identifier: {name}"

    def test_starts_with_test_prefix(self):
        name = make_function_name("AC1", "something works", "python")
        assert name.startswith("test_ac1_")

    def test_special_chars_removed(self):
        name = make_function_name("AC2", "handle (edge) case [with] brackets", "python")
        assert VALID_PYTHON_IDENT.match(name), f"Invalid identifier: {name}"


class TestMakeFunctionNameSwift:
    def test_no_hyphens_swift(self):
        name = make_function_name("AC1", "when-input-has-dashes", "swift")
        assert "-" not in name

    def test_starts_with_test(self):
        name = make_function_name("AC1", "view loads", "swift")
        assert name.startswith("test_ac1_")


class TestMakeFunctionNameGo:
    def test_pascal_case(self):
        name = make_function_name("AC1", "handler returns ok", "go")
        assert name.startswith("Test")
        assert "-" not in name
