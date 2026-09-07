"""Tests for per-lane SPM subpackage test_command scoping (#394).

`datum/tdd_driver.py` has `detect_spm_subpackage` / `get_spm_test_command` — a
producer with no consumer. This wires it into `build_lane_plan`: a Swift lane
whose .swift files all live under the same nested subpackage (its own
Package.swift, not the repo root's) gets `test_command` set to
`swift test --package-path <subpackage>` so the runner doesn't try to build
against the wrong dependency graph. A lane spanning multiple subpackages (or
mixing subpackage + root) gets no override and a warning instead. An explicit
per-task test_command always wins.
"""

from __future__ import annotations

from pathlib import Path

from datum.lane_plan import build_lane_plan


def _task(tid, files, **extra):
    return {
        "id": tid,
        "title": tid,
        "files": files,
        "acceptance_criteria": ["it works"],
        "red_note": "red",
        "depends_on": [],
        **extra,
    }


def _make_spm_repo(tmp_path: Path) -> Path:
    """Root Package.swift + a nested Modules/Foo and Modules/Bar subpackage,
    each with their own Package.swift."""
    (tmp_path / "Package.swift").write_text("// root package")

    foo = tmp_path / "Modules" / "Foo"
    foo.mkdir(parents=True)
    (foo / "Package.swift").write_text("// foo package")
    (foo / "FooTests.swift").write_text("// foo tests")

    bar = tmp_path / "Modules" / "Bar"
    bar.mkdir(parents=True)
    (bar / "Package.swift").write_text("// bar package")
    (bar / "BarTests.swift").write_text("// bar tests")

    return tmp_path


class TestSpmLaneTestCommand:
    def test_lane_scoped_to_single_subpackage_gets_scoped_command(self, tmp_path):
        repo = _make_spm_repo(tmp_path)
        tasks = [_task("lane-foo", ["Modules/Foo/FooTests.swift"])]

        plan = build_lane_plan(tasks, ["lane-foo"], {}, repo_root=repo)

        assert (
            plan["lanes"]["lane-foo"]["test_command"]
            == "swift test --package-path Modules/Foo"
        )

    def test_lane_spanning_two_subpackages_gets_no_command_and_a_warning(
        self, tmp_path
    ):
        repo = _make_spm_repo(tmp_path)
        tasks = [
            _task(
                "lane-mixed",
                ["Modules/Foo/FooTests.swift", "Modules/Bar/BarTests.swift"],
            )
        ]

        plan = build_lane_plan(tasks, ["lane-mixed"], {}, repo_root=repo)

        assert "test_command" not in plan["lanes"]["lane-mixed"]
        assert plan.get("warnings")
        assert any("lane-mixed" in w for w in plan["warnings"])

    def test_explicit_test_command_wins_over_spm_detection(self, tmp_path):
        repo = _make_spm_repo(tmp_path)
        tasks = [
            _task(
                "lane-foo",
                ["Modules/Foo/FooTests.swift"],
                test_command="swift test --filter FooTests",
            )
        ]

        plan = build_lane_plan(tasks, ["lane-foo"], {}, repo_root=repo)

        assert (
            plan["lanes"]["lane-foo"]["test_command"] == "swift test --filter FooTests"
        )

    def test_python_repo_lane_is_unaffected(self, tmp_path):
        tasks = [_task("lane-py", ["datum/lane_plan.py"])]

        plan = build_lane_plan(
            tasks,
            ["lane-py"],
            {},
            global_test_command="uv run pytest -x -q",
            repo_root=tmp_path,
        )

        assert "test_command" not in plan["lanes"]["lane-py"]
        assert not plan.get("warnings")

    def test_lane_scoped_to_root_package_gets_no_override(self, tmp_path):
        """.swift files that only resolve to the repo-root Package.swift
        (not a nested subpackage) don't need `--package-path` scoping."""
        (tmp_path / "Package.swift").write_text("// root package")
        (tmp_path / "RootTests.swift").write_text("// root tests")
        tasks = [_task("lane-root", ["RootTests.swift"])]

        plan = build_lane_plan(
            tasks,
            ["lane-root"],
            {},
            global_test_command="swift test",
            repo_root=tmp_path,
        )

        assert "test_command" not in plan["lanes"]["lane-root"]
        assert not plan.get("warnings")
