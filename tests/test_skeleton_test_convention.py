"""Tests for skeleton_creator test-artifact convention support (#270).

R3 — infer_test_path must accept a task-declared test convention
(flat single-extension file vs. directory/package-style test target vs.
docs-only / no-source-test-file) and produce the correct stub target
for each shape, instead of always inferring a single flat-extension file.
"""

from datum.skeleton_creator import infer_test_path


class TestDirectoryTestConvention:
    def test_ac1_directory_convention_produces_package_style_stub(self):
        """AC1: a directory-path/glob test convention (e.g. a Swift/JVM-style
        test package dir) must produce a package-style stub target, not a
        flat single-extension file path.
        """
        task_files = ["Sources/Widgets/WidgetView.swift"]

        result = infer_test_path(
            task_files,
            language="swift",
            ac_id="AC1",
            test_convention="directory",
        )

        # A directory/package-style convention must resolve to the package
        # test directory, not a flat "<Name>Tests.swift" file.
        assert result == "Tests/WidgetsTests/"
        assert not result.endswith(".swift")


class TestDocsOnlyTestConvention:
    def test_ac2_docs_only_task_does_not_generate_flat_extension_stub(self):
        """AC2: a docs-only task (no source test file expected) must NOT
        generate a flat-extension test-file stub path.
        """
        task_files = ["docs/README.md"]

        result = infer_test_path(
            task_files,
            language="python",
            ac_id="AC1",
            test_convention="docs-only",
        )

        assert result is None


class TestFlatExtensionTestConvention:
    def test_ac3_existing_flat_extension_task_still_produces_flat_stub(self):
        """AC3: an existing single-flat-extension task must continue to
        generate the same flat test-file stub as before (no regression).
        """
        task_files = ["datum/foo.py"]

        result = infer_test_path(
            task_files,
            language="python",
            ac_id="AC1",
            test_convention="flat",
        )

        assert result == "tests/test_foo.py"
