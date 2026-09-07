"""Tests for skeleton_creator impl-stub placement (#388).

`datum skeleton` must never leave implementation stub files as untracked
source files in the checkout it runs in. Stubs belong ONLY in the
preflight JSON artifact (as `impl_stubs[*].content`) — GREEN reads the
content from there and writes the real file itself. Writing a stub to
disk left stray untracked files (e.g. src/caliper/core/part_score.py)
that collided with squash-merge and could shadow GREEN's implementation
with a NotImplementedError during RED.
"""

import json
import subprocess

from datum.skeleton_creator import build_impl_stubs, run_preflight


def _git_status_porcelain(repo: object) -> str:
    return subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=repo,
        capture_output=True,
        text=True,
        check=True,
    ).stdout


def _init_repo(tmp_path):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        ["git", "config", "user.email", "t@example.com"], cwd=tmp_path, check=True
    )
    subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp_path, check=True)
    return tmp_path


class TestBuildImplStubsNeverWritesDisk:
    def test_no_stub_file_written_for_missing_impl_file(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        impl_path = tmp_path / "src" / "caliper" / "core" / "part_score.py"

        stubs = build_impl_stubs(
            task_id="task-001",
            acs=["compute_part_score(part, weights) returns a float"],
            impl_files=[str(impl_path)],
            language="python",
        )

        assert not impl_path.exists(), "impl stub must not be written to disk"
        assert stubs, "expected a stub entry to still be produced"
        assert stubs[0]["path"] == str(impl_path)
        assert stubs[0]["stub_written"] is False
        assert "compute_part_score" in stubs[0]["content"]


class TestSkeletonPreflightRootCheckoutClean:
    def test_root_checkout_has_no_untracked_source_after_preflight(
        self, tmp_path, monkeypatch
    ):
        repo = _init_repo(tmp_path)
        monkeypatch.chdir(repo)

        tasks = [
            {
                "id": "task-001",
                "slug": "part-score",
                "acceptance_criteria": [
                    "compute_part_score(part, weights) returns a float"
                ],
                "files": [
                    "src/caliper/core/part_score.py",
                    "tests/test_part_score.py",
                ],
            }
        ]
        tasks_path = repo / "tasks.json"
        tasks_path.write_text(json.dumps(tasks))

        output_path = repo / ".datum" / "runs" / "run1" / "preflight-task-001.json"

        result = run_preflight(
            task_id="task-001",
            language="python",
            tasks_path=tasks_path,
            output_path=output_path,
            skip_file_writes=True,
        )

        # No untracked file under src/ — the impl stub must never land as a
        # real source file in the checkout that ran `datum skeleton`.
        status = _git_status_porcelain(repo)
        assert "src/" not in status, f"stray untracked source file(s):\n{status}"

        impl_path = repo / "src" / "caliper" / "core" / "part_score.py"
        assert not impl_path.exists()

        # The skeleton artifact must still carry the stub content for GREEN.
        assert output_path.exists()
        artifact = json.loads(output_path.read_text())
        stubs = artifact["impl_stubs"]
        assert stubs, "expected impl_stubs to be present in the artifact"
        assert stubs[0]["path"] == "src/caliper/core/part_score.py"
        assert "compute_part_score" in stubs[0]["content"]
        assert result["impl_stubs"] == stubs


# ============================================================================
# Characterization tests for _extract_swift_target_context
# ============================================================================


class TestExtractSwiftTargetContext:
    """Pins the behavior of _extract_swift_target_context (line 36, complexity 25)."""

    def test_returns_none_when_swift_package_dump_fails(self, tmp_path, monkeypatch):
        """When subprocess raises Exception (e.g., swift not available), return None."""
        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)
        # No swift binary available in test env typically
        result = _extract_swift_target_context(["Sources/MyTarget/main.swift"])
        assert result is None, "Should return None when swift package dump fails"

    def test_returns_none_when_no_targets_in_dump_output(self, tmp_path, monkeypatch):
        """When Package.swift exists but has no targets, return None."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        # Mock subprocess to return valid JSON with empty targets list
        def mock_check_output(*args, **kwargs):
            return json.dumps({"targets": []})

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(["Sources/MyTarget/main.swift"])
        assert result is None, "Should return None when targets list is empty"

    def test_returns_none_when_task_files_not_in_sources_or_tests(
        self, tmp_path, monkeypatch
    ):
        """When task files don't follow Sources/*/... or Tests/*Tests/... pattern, return None."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        def mock_check_output(*args, **kwargs):
            return json.dumps(
                {
                    "targets": [
                        {"name": "MyTarget", "dependencies": []},
                    ]
                }
            )

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(["root_file.swift", "other/path.swift"])
        assert (
            result is None
        ), "Should return None when no task files match Sources/*/... pattern"

    def test_extracts_target_context_with_matching_files(self, tmp_path, monkeypatch):
        """When task files match target paths, return formatted context string."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        def mock_check_output(*args, **kwargs):
            return json.dumps(
                {
                    "targets": [
                        {"name": "MyApp", "dependencies": []},
                        {"name": "MyLib", "dependencies": []},
                    ]
                }
            )

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(
            ["Sources/MyApp/main.swift", "Sources/MyLib/utils.swift"]
        )
        assert result is not None
        assert "Swift Package Context:" in result
        assert "Target: MyApp" in result
        assert "Target: MyLib" in result
        assert "Depends on: [None]" in result

    def test_extracts_dependencies_from_byname(self, tmp_path, monkeypatch):
        """When targets have dependencies with byName structure, extract them."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        def mock_check_output(*args, **kwargs):
            return json.dumps(
                {
                    "targets": [
                        {
                            "name": "MyApp",
                            "dependencies": [
                                {"byName": ["FoundationSupport"]},
                                {"byName": ["Networking"]},
                            ],
                        }
                    ]
                }
            )

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(["Sources/MyApp/main.swift"])
        assert result is not None
        assert "FoundationSupport, Networking" in result

    def test_extracts_dependencies_from_target_key(self, tmp_path, monkeypatch):
        """When dependencies use 'target' key, extract them."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        def mock_check_output(*args, **kwargs):
            return json.dumps(
                {
                    "targets": [
                        {
                            "name": "MyApp",
                            "dependencies": [
                                {"target": ["CoreLib"]},
                            ],
                        }
                    ]
                }
            )

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(["Sources/MyApp/main.swift"])
        assert result is not None
        assert "CoreLib" in result

    def test_extracts_dependencies_from_product_key(self, tmp_path, monkeypatch):
        """When dependencies use 'product' key, extract them."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        def mock_check_output(*args, **kwargs):
            return json.dumps(
                {
                    "targets": [
                        {
                            "name": "MyApp",
                            "dependencies": [
                                {"product": ["Alamofire"]},
                            ],
                        }
                    ]
                }
            )

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(["Sources/MyApp/main.swift"])
        assert result is not None
        assert "Alamofire" in result

    def test_handles_tests_directory_pattern(self, tmp_path, monkeypatch):
        """When task files are in Tests/*/Tests pattern, extract them."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        def mock_check_output(*args, **kwargs):
            return json.dumps(
                {
                    "targets": [
                        {"name": "MyAppTests", "dependencies": []},
                    ]
                }
            )

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(["Tests/MyAppTests/MyAppTests.swift"])
        assert result is not None
        assert "Target: MyAppTests" in result

    def test_non_dict_dependencies_ignored(self, tmp_path, monkeypatch):
        """When dependencies contain non-dict items, skip them gracefully."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        def mock_check_output(*args, **kwargs):
            return json.dumps(
                {
                    "targets": [
                        {
                            "name": "MyApp",
                            "dependencies": [
                                "InvalidStringDep",
                                {"byName": ["ValidDep"]},
                            ],
                        }
                    ]
                }
            )

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        result = _extract_swift_target_context(["Sources/MyApp/main.swift"])
        assert result is not None
        assert "ValidDep" in result

    def test_silent_exception_fallback_when_subprocess_fails(
        self, tmp_path, monkeypatch
    ):
        """FLAG: Silent fallback on line 42 — catches ALL exceptions and returns None."""
        import subprocess as sp

        from datum.skeleton_creator import _extract_swift_target_context

        monkeypatch.chdir(tmp_path)

        # Mock subprocess to raise an exception
        def mock_check_output(*args, **kwargs):
            raise ValueError("JSON decode error or subprocess failure")

        monkeypatch.setattr(sp, "check_output", mock_check_output)

        # The function silently returns None instead of propagating or logging the error
        result = _extract_swift_target_context(["Sources/MyApp/main.swift"])
        assert (
            result is None
        )  # This is correct behavior for when swift package dump fails
        # BUT: no logging/warning is issued about the failure (SILENT FALLBACK)
        # This mask real issues like JSON corruption or subprocess crashes


# ============================================================================
# Characterization tests for _detect_swift_framework
# ============================================================================


class TestDetectSwiftFramework:
    """Pins the behavior of _detect_swift_framework (line 81, complexity 12)."""

    def test_returns_xctest_when_file_imports_xctest(self, tmp_path):
        """When test file contains 'import XCTest', return 'xctest'."""
        from datum.skeleton_creator import _detect_swift_framework

        test_file = tmp_path / "Tests" / "MyTests.swift"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("""
import XCTest
import Foundation

class MyTests: XCTestCase {
    func testExample() {}
}
""")

        result = _detect_swift_framework(str(test_file))
        assert result == "xctest"

    def test_returns_swift_testing_when_file_imports_testing(self, tmp_path):
        """When test file contains 'import Testing', return 'swift-testing'."""
        from datum.skeleton_creator import _detect_swift_framework

        test_file = tmp_path / "Tests" / "MyTests.swift"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("""
import Testing
import Foundation

@Suite
struct MyTests {
    @Test func example() {}
}
""")

        result = _detect_swift_framework(str(test_file))
        assert result == "swift-testing"

    def test_xctest_takes_precedence_when_both_imports_present(self, tmp_path):
        """When both XCTest and Testing are imported, XCTest should be found first."""
        from datum.skeleton_creator import _detect_swift_framework

        test_file = tmp_path / "Tests" / "MyTests.swift"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("""
import XCTest
import Testing
""")

        result = _detect_swift_framework(str(test_file))
        assert result == "xctest"

    def test_returns_default_when_no_test_framework_found(self, tmp_path):
        """When no XCTest or Testing import found, return default 'swift-testing'."""
        from datum.skeleton_creator import _detect_swift_framework

        test_file = tmp_path / "Tests" / "MyTests.swift"
        test_file.parent.mkdir(parents=True)
        test_file.write_text("""
import Foundation

func someHelper() {}
""")

        result = _detect_swift_framework(str(test_file))
        assert result == "swift-testing"

    def test_searches_parent_directory_when_file_missing(self, tmp_path):
        """When test file doesn't exist, search parent dir."""
        from datum.skeleton_creator import _detect_swift_framework

        tests_dir = tmp_path / "Tests" / "MyTests"
        tests_dir.mkdir(parents=True)

        # Create a file in Tests/MyTests/ with XCTest
        other_file = tests_dir / "OtherFile.swift"
        other_file.write_text("import XCTest")

        # Query non-existent file in that dir
        result = _detect_swift_framework(str(tests_dir / "Nonexistent.swift"))
        assert result == "xctest"

    def test_returns_default_when_no_files_in_directory(self, tmp_path):
        """When test directory is empty, return default."""
        from datum.skeleton_creator import _detect_swift_framework

        tests_dir = tmp_path / "Tests" / "Empty"
        tests_dir.mkdir(parents=True)

        result = _detect_swift_framework(str(tests_dir / "NoFile.swift"))
        assert result == "swift-testing"

    def test_searches_recursively_in_test_directory(self, tmp_path):
        """When searching test dir, recursively find framework usage."""
        from datum.skeleton_creator import _detect_swift_framework

        tests_dir = tmp_path / "Tests" / "MyTests"
        tests_dir.mkdir(parents=True)

        nested_dir = tests_dir / "Nested"
        nested_dir.mkdir()

        # Create Testing import in nested file
        nested_file = nested_dir / "NestedTests.swift"
        nested_file.write_text("import Testing")

        result = _detect_swift_framework(str(tests_dir / "Nonexistent.swift"))
        assert result == "swift-testing"

    def test_navigates_up_to_tests_directory(self, tmp_path):
        """When test file is deep, navigate up to Tests/ and search."""
        from datum.skeleton_creator import _detect_swift_framework

        # Create Tests/MyTests/UnitTests/SpecificTest/SomeTest.swift
        deep_tests_dir = tmp_path / "Tests" / "MyTests" / "UnitTests" / "SpecificTest"
        deep_tests_dir.mkdir(parents=True)

        # Put XCTest marker at Tests/MyTests/ level
        marker_file = tmp_path / "Tests" / "MyTests" / "Marker.swift"
        marker_file.write_text("import XCTest")

        # Query a nonexistent file deep in the hierarchy
        result = _detect_swift_framework(str(deep_tests_dir / "Missing.swift"))
        # Should navigate up and find XCTest in parent Tests/MyTests/
        assert result == "xctest"


# ============================================================================
# Characterization tests for build_impl_stubs
# ============================================================================


class TestBuildImplStubs:
    """Pins the behavior of build_impl_stubs (line 262, complexity 24)."""

    def test_returns_empty_list_when_no_signatures_extracted(
        self, tmp_path, monkeypatch
    ):
        """When no function signatures found in ACs, return []."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["Just plain text with no function calls"],
            impl_files=["src/impl.py"],
            language="python",
        )
        assert result == []

    def test_skips_files_that_already_exist(self, tmp_path, monkeypatch):
        """When an impl file exists, skip it (don't generate stub)."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        impl_file = tmp_path / "src" / "impl.py"
        impl_file.parent.mkdir(parents=True)
        impl_file.write_text("# existing code")

        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x) returns int"],
            impl_files=[str(impl_file)],
            language="python",
        )
        assert result == [], "Should not generate stub for existing file"

    def test_skips_unknown_extension(self, tmp_path, monkeypatch):
        """When file extension is unknown, skip it."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x) returns int"],
            impl_files=["src/impl.txt"],  # .txt not in ext_lang_map
            language="python",
        )
        assert result == []

    def test_skips_extension_language_mismatch(self, tmp_path, monkeypatch):
        """When extension language doesn't match task language, skip."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        # .ts file but language is python
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x) returns int"],
            impl_files=["src/impl.ts"],
            language="python",  # Mismatch: .ts is typescript
        )
        assert result == []

    def test_generates_python_stub_for_missing_file(self, tmp_path, monkeypatch):
        """When .py file doesn't exist, generate Python stub."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x, y) returns int"],
            impl_files=["src/impl.py"],
            language="python",
        )
        assert len(result) == 1
        stub = result[0]
        assert stub["path"] == "src/impl.py"
        assert stub["stub_written"] is False
        assert "compute" in stub["content"]
        assert "def compute(x, y):" in stub["content"]
        assert "    ..." in stub["content"]
        assert not (tmp_path / "src" / "impl.py").exists()

    def test_generates_typescript_stub_for_missing_file(self, tmp_path, monkeypatch):
        """When .ts file doesn't exist, generate TypeScript stub."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x, y) returns int"],
            impl_files=["src/impl.ts"],
            language="typescript",
        )
        assert len(result) == 1
        stub = result[0]
        assert "function compute(x, y)" in stub["content"]
        assert "TODO: GREEN fills this in" in stub["content"]

    def test_generates_swift_stub_for_missing_file(self, tmp_path, monkeypatch):
        """When .swift file doesn't exist, generate Swift stub."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x, y) returns int"],
            impl_files=["src/impl.swift"],
            language="swift",
        )
        assert len(result) == 1
        stub = result[0]
        assert "func compute(x, y)" in stub["content"]
        assert 'fatalError("RED agent: implement")' in stub["content"]

    def test_generates_go_stub_for_missing_file(self, tmp_path, monkeypatch):
        """When .go file doesn't exist, generate Go stub."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x, y) returns int"],
            impl_files=["impl.go"],
            language="go",
        )
        assert len(result) == 1
        stub = result[0]
        assert "func compute(x, y)" in stub["content"]

    def test_multiple_functions_in_single_file(self, tmp_path, monkeypatch):
        """When multiple functions extracted from ACs, generate all stubs."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=[
                "compute(x) returns int",
                "validate(x) returns bool",
            ],
            impl_files=["src/impl.py"],
            language="python",
        )
        assert len(result) == 1
        stub = result[0]
        assert "compute" in stub["content"]
        assert "validate" in stub["content"]
        assert "def compute" in stub["content"]
        assert "def validate" in stub["content"]

    def test_deduplicates_function_names(self, tmp_path, monkeypatch):
        """When same function name appears in multiple ACs, generate only once."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=[
                "compute(x) returns int",
                "compute(x) with different behavior",
            ],
            impl_files=["src/impl.py"],
            language="python",
        )
        assert len(result) == 1
        stub = result[0]
        # Should only have one "def compute"
        assert stub["content"].count("def compute") == 1

    def test_stub_never_written_to_disk(self, tmp_path, monkeypatch):
        """Verify stub_written is always False and no file is created."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x) returns int"],
            impl_files=["src/impl.py"],
            language="python",
        )
        assert len(result) == 1
        assert result[0]["stub_written"] is False
        assert not (tmp_path / "src" / "impl.py").exists()

    def test_content_field_populated_with_stub_code(self, tmp_path, monkeypatch):
        """Verify content field contains the generated stub code."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x, y, z) returns float"],
            impl_files=["src/impl.py"],
            language="python",
        )
        assert len(result) == 1
        content = result[0]["content"]
        assert isinstance(content, str)
        assert len(content) > 0
        assert "def compute" in content
        assert "x, y, z" in content

    def test_functions_list_extracted_correctly(self, tmp_path, monkeypatch):
        """Verify functions list contains all generated functions."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=[
                "process(data) returns list",
                "validate(data) returns bool",
            ],
            impl_files=["src/impl.py"],
            language="python",
        )
        assert len(result) == 1
        assert set(result[0]["functions"]) == {"process", "validate"}

    def test_handles_jsx_tsx_extensions(self, tmp_path, monkeypatch):
        """Verify TSX files are treated as TypeScript, JSX as JavaScript."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        # TSX should work with typescript language
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x) returns int"],
            impl_files=["src/impl.tsx"],
            language="typescript",
        )
        assert len(result) == 1
        assert "impl.tsx" in result[0]["path"]

        # JSX should work with javascript language
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x) returns int"],
            impl_files=["src/impl.jsx"],
            language="javascript",
        )
        assert len(result) == 1
        assert "impl.jsx" in result[0]["path"]

    def test_handles_pyx_extension(self, tmp_path, monkeypatch):
        """Verify .pyx (Cython) files are treated as Python."""
        from datum.skeleton_creator import build_impl_stubs

        monkeypatch.chdir(tmp_path)
        result = build_impl_stubs(
            task_id="task-001",
            acs=["compute(x) returns int"],
            impl_files=["src/impl.pyx"],
            language="python",
        )
        assert len(result) == 1
        assert "impl.pyx" in result[0]["path"]


class TestDetectSwiftFrameworkNonexistentNestedDir:
    def test_climbs_from_a_not_yet_created_test_dir_to_the_nearest_existing_ancestor(
        self, tmp_path
    ):
        """The RED agent's new test file usually lives in a directory that does
        not exist yet. Detection must climb to the nearest EXISTING ancestor
        (and on up to Tests/) and scan there — not return the default because
        the leaf directory is missing."""
        from datum.skeleton_creator import _detect_swift_framework

        (tmp_path / "Tests" / "MyTests").mkdir(parents=True)
        (tmp_path / "Tests" / "MyTests" / "Marker.swift").write_text("import XCTest")

        missing_dir = (
            tmp_path / "Tests" / "MyTests" / "UnitTests" / "Specific"
        )  # NOT created
        result = _detect_swift_framework(str(missing_dir / "New.swift"))
        assert result == "xctest"
