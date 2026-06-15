"""Tests for skeleton_creator append-or-create behavior (#160).

When multiple ACs map to the same test file, skeleton_creator must
APPEND new skeletons rather than overwriting existing content.
"""

from datum.skeleton_creator import _write_skeleton, build_skeleton


class TestWriteSkeleton:
    def test_creates_file_when_absent(self, tmp_path):
        dest = tmp_path / "tests" / "test_foo.py"
        _write_skeleton(dest, "# first content")
        assert dest.read_text() == "# first content"

    def test_appends_when_file_exists(self, tmp_path):
        dest = tmp_path / "tests" / "test_foo.py"
        _write_skeleton(dest, "# first")
        _write_skeleton(dest, "# second")
        text = dest.read_text()
        assert "# first" in text
        assert "# second" in text

    def test_creates_parent_dirs(self, tmp_path):
        dest = tmp_path / "deep" / "nested" / "test_bar.py"
        _write_skeleton(dest, "content")
        assert dest.exists()


class TestSkeletonAppendIntegration:
    def test_second_ac_preserves_first(self, tmp_path):
        """Two ACs targeting the same file — both must be present."""
        task_files = ["datum/foo.py"]
        s1 = build_skeleton(
            task_id="task-1",
            ac_id="AC1",
            ac_text="first acceptance criterion",
            property_id="PROP-001",
            predicate_short="first acceptance criterion",
            task_files=task_files,
            language="python",
        )
        s2 = build_skeleton(
            task_id="task-1",
            ac_id="AC2",
            ac_text="second acceptance criterion",
            property_id="PROP-002",
            predicate_short="second acceptance criterion",
            task_files=task_files,
            language="python",
        )

        dest = tmp_path / "tests" / "test_foo.py"
        _write_skeleton(dest, s1.pop("content"))
        _write_skeleton(dest, s2.pop("content"))

        text = dest.read_text()
        assert "test_ac1_" in text, "AC1 skeleton was overwritten"
        assert "test_ac2_" in text, "AC2 skeleton missing"

    def test_three_acs_all_survive(self, tmp_path):
        """Three ACs same file — all three must be present."""
        task_files = ["datum/baz.py"]
        skeletons = []
        for i in range(3):
            skeletons.append(
                build_skeleton(
                    task_id="task-3",
                    ac_id=f"AC{i + 1}",
                    ac_text=f"criterion number {i + 1}",
                    property_id=f"PROP-{i + 1:03d}",
                    predicate_short=f"criterion number {i + 1}",
                    task_files=task_files,
                    language="python",
                )
            )

        dest = tmp_path / "tests" / "test_baz.py"
        for s in skeletons:
            _write_skeleton(dest, s.pop("content"))

        text = dest.read_text()
        assert "test_ac1_" in text, "AC1 lost"
        assert "test_ac2_" in text, "AC2 lost"
        assert "test_ac3_" in text, "AC3 lost"
