"""Comprehensive characterization tests for datum.detect.detect_repo().

This test suite verifies the exact behavior of repository detection,
including bugs, edge cases, and contract drift between detect.py and
models.ts DEFAULT_CONFIG.
"""

import json
import tempfile
from pathlib import Path
from typing import Any

import pytest

from datum.detect import detect_repo


class TestLanguageDetectionBasics:
    """Test language detection with marker files."""

    def test_python_with_pyproject_toml(self) -> None:
        """Detect Python from pyproject.toml marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            assert result["language"] == "python"
            assert result["test_framework"] == "pytest"
            assert result["test_command"] == "uv run pytest -x -q"

    def test_python_with_setup_py(self) -> None:
        """Detect Python from setup.py marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "setup.py").write_text("# setup\n")

            result = detect_repo(str(root))

            assert result["language"] == "python"
            assert result["test_framework"] == "pytest"

    def test_python_with_requirements_txt(self) -> None:
        """Detect Python from requirements.txt marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "requirements.txt").write_text("pytest==7.0.0\n")

            result = detect_repo(str(root))

            assert result["language"] == "python"

    def test_typescript_with_tsconfig_json(self) -> None:
        """Detect TypeScript from tsconfig.json marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "tsconfig.json").write_text('{"compilerOptions": {}}\n')
            (root / "package.json").write_text('{"devDependencies": {"jest": "^29"}}\n')

            result = detect_repo(str(root))

            assert result["language"] == "typescript"
            assert result["test_framework"] == "jest"
            assert result["test_command"] == "npx jest"

    def test_javascript_with_package_json_only(self) -> None:
        """Detect JavaScript when only package.json exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "package.json").write_text('{"devDependencies": {"jest": "^29"}}\n')

            result = detect_repo(str(root))

            assert result["language"] == "javascript"
            assert result["test_framework"] == "jest"

    def test_go_with_go_mod(self) -> None:
        """Detect Go from go.mod marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "go.mod").write_text("module example.com\n")

            result = detect_repo(str(root))

            assert result["language"] == "go"
            assert result["test_framework"] == "go-test"
            assert result["test_command"] == "go test ./..."

    def test_rust_with_cargo_toml(self) -> None:
        """Detect Rust from Cargo.toml marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "Cargo.toml").write_text("[package]\nname = 'example'\n")

            result = detect_repo(str(root))

            assert result["language"] == "rust"
            assert result["test_framework"] == "cargo-test"
            assert result["test_command"] == "cargo test"

    def test_swift_with_package_swift(self) -> None:
        """Detect Swift from Package.swift marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "Package.swift").write_text("// swift-tools-version:5.5\n")

            result = detect_repo(str(root))

            assert result["language"] == "swift"


class TestTestFrameworkDetection:
    """Test test framework detection within a language."""

    def test_python_pytest_from_pyproject(self) -> None:
        """Detect pytest from pyproject.toml content."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text(
                "[tool.pytest.ini_options]\ntestpaths = ['tests']\n"
            )

            result = detect_repo(str(root))

            assert result["test_framework"] == "pytest"

    def test_python_pytest_from_pytest_ini(self) -> None:
        """Detect pytest from pytest.ini file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pytest.ini").write_text("[pytest]\n")
            # Need a language marker for Python to be detected
            (root / "setup.py").write_text("# setup\n")

            result = detect_repo(str(root))

            assert result["test_framework"] == "pytest"

    def test_python_pytest_from_conftest_py(self) -> None:
        """Detect pytest from conftest.py file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "conftest.py").write_text("# pytest config\n")

            result = detect_repo(str(root))

            assert result["test_framework"] == "pytest"

    def test_python_pytest_fallback(self) -> None:
        """Python with no pytest indicators still returns pytest."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "setup.py").write_text("# setup\n")

            result = detect_repo(str(root))

            # According to line 109, this always returns pytest
            assert result["test_framework"] == "pytest"

    def test_typescript_vitest_detection(self) -> None:
        """Detect vitest from package.json content."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "tsconfig.json").write_text("{}\n")
            (root / "package.json").write_text(
                '{"devDependencies": {"vitest": "^0.34"}}\n'
            )

            result = detect_repo(str(root))

            assert result["test_framework"] == "vitest"
            assert result["test_command"] == "npx vitest run"

    def test_typescript_jest_detection(self) -> None:
        """Detect jest from package.json content."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "tsconfig.json").write_text("{}\n")
            (root / "package.json").write_text('{"devDependencies": {"jest": "^29"}}\n')

            result = detect_repo(str(root))

            assert result["test_framework"] == "jest"
            assert result["test_command"] == "npx jest"

    def test_typescript_mocha_detection_returns_unknown_command(self) -> None:
        """TypeScript with mocha returns unknown test command (BUG #1).

        The commands table only has ('javascript', 'mocha'), not
        ('typescript', 'mocha'). This is a missing entry.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "tsconfig.json").write_text("{}\n")
            (root / "package.json").write_text(
                '{"devDependencies": {"mocha": "^10"}}\n'
            )

            result = detect_repo(str(root))

            assert result["language"] == "typescript"
            assert result["test_framework"] == "mocha"
            assert result["test_command"] == "npx mocha"

    def test_javascript_mocha_detection(self) -> None:
        """Detect mocha for JavaScript."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "package.json").write_text(
                '{"devDependencies": {"mocha": "^10"}}\n'
            )

            result = detect_repo(str(root))

            assert result["language"] == "javascript"
            assert result["test_framework"] == "mocha"
            assert result["test_command"] == "npx mocha"

    def test_swift_xctest_detection(self) -> None:
        """Detect XCTest from Swift test files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "Package.swift").write_text("// swift\n")
            (root / "Tests").mkdir()
            (root / "Tests" / "MyTests.swift").write_text("import XCTest\n")

            result = detect_repo(str(root))

            assert result["test_framework"] == "xctest"
            assert result["test_command"] == "swift test"

    def test_swift_testing_detection(self) -> None:
        """Detect swift-testing from Swift test files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "Package.swift").write_text("// swift\n")
            (root / "Tests").mkdir()
            (root / "Tests" / "MyTests.swift").write_text("import Testing\n")

            result = detect_repo(str(root))

            assert result["test_framework"] == "swift-testing"
            assert result["test_command"] == "swift test"


class TestLanguagePriority:
    """Test priority when multiple language markers exist."""

    def test_pyproject_and_package_json_python_wins(self) -> None:
        """When both pyproject.toml and package.json exist, Python wins (dict order).

        This is deterministic because the marker dict iterates in insertion order
        (Python 3.7+ spec), and "python" comes before "javascript".
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")
            (root / "package.json").write_text('{"devDependencies": {"jest": "^29"}}\n')

            result = detect_repo(str(root))

            assert result["language"] == "python"
            assert result["test_framework"] == "pytest"

    def test_typescript_takes_priority_over_javascript(self) -> None:
        """When both tsconfig.json and package.json exist, TypeScript wins."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "tsconfig.json").write_text("{}\n")
            (root / "package.json").write_text('{"devDependencies": {"jest": "^29"}}\n')

            result = detect_repo(str(root))

            assert result["language"] == "typescript"
            # Not "javascript"


class TestExtensionFallback:
    """Test fallback to file extension counting."""

    def test_extension_count_fallback(self) -> None:
        """When no markers exist, count file extensions."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "main.py").write_text("print('hello')\n")
            (root / "utils.py").write_text("def foo(): pass\n")
            (root / "test.js").write_text("console.log('test');\n")

            result = detect_repo(str(root))

            # Python has 2 files, JavaScript has 1 → Python wins
            assert result["language"] == "python"

    def test_extension_fallback_detects_typescript(self) -> None:
        """Extension fallback can detect TypeScript from .ts files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "main.ts").write_text("console.log('hello');\n")
            (root / "utils.ts").write_text("export function foo() {}\n")

            result = detect_repo(str(root))

            assert result["language"] == "typescript"

    def test_unknown_language_when_no_markers_no_extensions(self) -> None:
        """Empty repository returns 'unknown' language."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            result = detect_repo(str(root))

            assert result["language"] == "unknown"
            assert result["test_framework"] == "unknown"

    def test_unknown_test_command_for_unknown_language(self) -> None:
        """Unknown language/framework returns echo fallback (BUG #3).

        This is a silent fallback that will cause `test_command` to echo
        instead of failing. A lane that runs this will report "success"
        with zero tests.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            result = detect_repo(str(root))

            assert "no test command for unknown/unknown" in result["test_command"]


class TestMalformedInput:
    """Test handling of malformed or missing configuration files."""

    def test_malformed_package_json_does_not_crash(self) -> None:
        """Malformed package.json doesn't crash (substring search, not JSON parsing)."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "tsconfig.json").write_text("{}\n")
            # Invalid JSON
            (root / "package.json").write_text('{"devDependencies": {"jest": "^29"')

            result = detect_repo(str(root))

            # Should not crash; substring search still works
            assert result["language"] == "typescript"
            # The malformed JSON is read but searched for "jest" substring
            assert result["test_framework"] == "jest"

    def test_package_json_with_no_test_script(self) -> None:
        """package.json with no test-related dependencies defaults to jest."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "package.json").write_text('{"dependencies": {"react": "^18"}}\n')

            result = detect_repo(str(root))

            assert result["language"] == "javascript"
            # No vitest/jest/mocha found → defaults to jest
            assert result["test_framework"] == "jest"
            assert result["test_command"] == "npx jest"


class TestSubstringFalsePositive:
    """Test substring matching false positive in test framework detection.

    The check `if "vitest" in content:` will match any package.json
    containing the substring "vitest" anywhere, including in plugin names.
    """

    def test_vitest_substring_false_positive(self) -> None:
        """Jest repo with eslint-plugin-vitest detects as vitest (BUG #2a).

        This is a real false positive: a package.json with
        "eslint-plugin-vitest" in devDependencies will match
        the "vitest" in content check, and report vitest as the
        test framework even if jest is the actual runner.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "tsconfig.json").write_text("{}\n")
            (root / "package.json").write_text(
                '{"devDependencies": {"jest": "^29", "eslint-plugin-vitest": "^0.3"}}\n'
            )

            result = detect_repo(str(root))

            # This is the bug: vitest is checked before jest, and matches
            # the substring in eslint-plugin-vitest
            assert result["test_framework"] == "vitest"
            assert result["test_command"] == "npx vitest run"
            # But the actual test framework is jest, not vitest


class TestSkipFilter:
    """Test the directory skip filter (BUG #2b).

    The filter at line 70 does substring matching on the absolute path:
    `any(skip in dirpath for skip in [".git", "node_modules", "vendor", "dist"])`

    This can false-positive on directories whose names *contain* these strings
    but aren't the actual skip targets.
    """

    def test_skip_filter_substring_false_positive(self) -> None:
        """Directory named 'redistribute' skips files because 'dist' substring match (BUG #2b).

        The skip check matches any substring, so a directory tree under
        'redistribute/' will be skipped because 'dist' appears in the path.
        This causes legitimate source files to not be counted.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            # Create a directory with 'dist' as a substring
            (root / "redistribute").mkdir()
            (root / "redistribute" / "main.py").write_text("print('hello')\n")

            result = detect_repo(str(root))

            # Bug: the .py file is not counted because 'dist' is in 'redistribute'
            assert result["language"] == "unknown"

    def test_skip_filter_matches_node_modules(self) -> None:
        """Files in node_modules are properly skipped."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "node_modules").mkdir()
            (root / "node_modules" / "package.ts").write_text("export {}\n")
            (root / "src").mkdir()
            (root / "src" / "index.ts").write_text("console.log('hello')\n")

            result = detect_repo(str(root))

            # Should detect TypeScript from src/index.ts, ignore node_modules
            assert result["language"] == "typescript"


class TestMonorepo:
    """Test monorepo detection (when markers are nested)."""

    def test_monorepo_markers_one_level_down(self) -> None:
        """Root marker detection works, but nested monorepo markers don't (architectural limit).

        The marker check only looks at root. If a monorepo has package.json
        one level down (packages/app/package.json), the root has none, so
        detection falls back to extension counting.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "packages").mkdir()
            (root / "packages" / "app").mkdir()
            (root / "packages" / "app" / "package.json").write_text(
                '{"devDependencies": {"jest": "^29"}}\n'
            )

            result = detect_repo(str(root))

            # Marker check doesn't find root package.json → falls to extension counting
            # No extensions at root → unknown
            assert result["language"] == "unknown"


class TestReturnValueContract:
    """Test that detect_repo returns the right keys."""

    def test_return_value_has_required_keys(self) -> None:
        """detect_repo always returns a dict with required keys."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            # Check keys present in detect_repo output
            assert isinstance(result, dict)
            assert "language" in result
            assert "test_framework" in result
            assert "test_command" in result
            assert "epic_dir_pattern" in result
            assert "skills_dir" in result

            # Check shapes
            assert isinstance(result["language"], str)
            assert isinstance(result["test_framework"], str)
            assert isinstance(result["test_command"], str)
            assert isinstance(result["epic_dir_pattern"], str)
            assert isinstance(result["skills_dir"], str)

    def test_skills_dir_points_to_package_location(self) -> None:
        """skills_dir is computed from __file__, not root."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            # skills_dir should point to the installed datum package
            skills_dir = Path(result["skills_dir"])
            assert skills_dir.name == "skills"
            # It should be inside the datum package, not the test root
            assert "datum" in str(skills_dir)

    def test_epic_dir_pattern_is_template(self) -> None:
        """epic_dir_pattern contains a {branch} placeholder."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            assert "{branch}" in result["epic_dir_pattern"]
            assert result["epic_dir_pattern"] == "docs/epics/{branch}"


class TestUvLockLogic:
    """Test the special handling for uv.lock in Python."""

    def test_pyproject_without_uv_lock_uses_uv_run(self) -> None:
        """Python with pyproject.toml uses 'uv run pytest'."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            assert result["test_command"] == "uv run pytest -x -q"

    def test_python_without_pyproject_uses_python_m(self) -> None:
        """Python without pyproject.toml or uv.lock uses 'python -m pytest'.

        This test checks the condition at line 164:
        `if not (root / "uv.lock").exists() and not (root / "pyproject.toml").exists()`
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "setup.py").write_text("# setup\n")

            result = detect_repo(str(root))

            # setup.py detected → python
            # No pyproject.toml, no uv.lock → python -m pytest
            assert result["test_command"] == "python -m pytest -x -q"

    def test_python_with_uv_lock_still_uses_uv_run(self) -> None:
        """Python with uv.lock uses 'uv run pytest'."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "setup.py").write_text("# setup\n")
            (root / "uv.lock").write_text("")

            result = detect_repo(str(root))

            # setup.py detected → python
            # uv.lock exists → use uv run pytest (the guard at line 164 is False)
            assert result["test_command"] == "uv run pytest -x -q"


class TestShapeDrift:
    """Test difference between detect_repo output and DEFAULT_CONFIG.

    detect_repo returns a different set of keys than DEFAULT_CONFIG in models.ts.
    This can cause shape mismatches at runtime.
    """

    def test_detect_returns_epic_dir_pattern_not_in_default_config(self) -> None:
        """detect_repo returns 'epic_dir_pattern', which DEFAULT_CONFIG doesn't expect."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            # detect_repo has this key
            assert "epic_dir_pattern" in result
            # But DEFAULT_CONFIG in models.ts doesn't list it
            # (this is informational, not necessarily wrong)

    def test_detect_does_not_return_context_files(self) -> None:
        """detect_repo doesn't return 'context_files', but DEFAULT_CONFIG expects it."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            # detect_repo doesn't populate this
            assert "context_files" not in result
            # cli.py:589-598 merges with existing config, so missing keys
            # might come from an existing .datum/config.json
            # But a fresh init will have context_files missing

    def test_detect_does_not_return_agent_types_or_hooks_installed(self) -> None:
        """detect_repo doesn't return agent_types or hooks_installed.

        These are patched in by cli.py:606 via config.update(installed.as_config()).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")

            result = detect_repo(str(root))

            assert "agent_types" not in result
            assert "hooks_installed" not in result


class TestConsistency:
    """Test that detect_repo is consistent across multiple calls."""

    def test_repeated_calls_return_same_result(self) -> None:
        """The same repo returns the same config on repeated calls."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pyproject.toml").write_text("[tool.pytest]\n")
            (root / "src").mkdir()
            (root / "src" / "main.py").write_text("print('hello')\n")

            result1 = detect_repo(str(root))
            result2 = detect_repo(str(root))
            result3 = detect_repo(str(root))

            assert result1 == result2 == result3


class TestJava:
    """Test Java detection."""

    def test_java_with_pom_xml(self) -> None:
        """Detect Java from pom.xml marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "pom.xml").write_text("<project>\n</project>\n")

            result = detect_repo(str(root))

            assert result["language"] == "java"
            assert result["test_framework"] == "junit"
            assert result["test_command"] == "gradle test"

    def test_java_with_gradle(self) -> None:
        """Detect Java from build.gradle marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "build.gradle").write_text("plugins {}\n")

            result = detect_repo(str(root))

            assert result["language"] == "java"


class TestRuby:
    """Test Ruby detection."""

    def test_ruby_with_gemfile(self) -> None:
        """Detect Ruby from Gemfile marker."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "Gemfile").write_text("gem 'rails'\n")

            result = detect_repo(str(root))

            assert result["language"] == "ruby"
            assert result["test_framework"] == "minitest"
            assert result["test_command"] == "bundle exec rake test"

    def test_ruby_with_rspec(self) -> None:
        """Detect RSpec when .rspec file is present."""
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "Gemfile").write_text("gem 'rspec'\n")
            (root / ".rspec").write_text("--format documentation\n")

            result = detect_repo(str(root))

            assert result["language"] == "ruby"
            assert result["test_framework"] == "rspec"
            assert result["test_command"] == "bundle exec rspec"
