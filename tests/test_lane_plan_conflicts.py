"""Tests for file-conflict → depends_on edge injection (#159, #163, #280)."""

from datum.lane_plan import (
    build_file_ownership,
    inject_conflict_edges,
    inject_read_dependency_edges,
)


class TestBuildFileOwnership:
    def test_no_conflicts(self):
        tasks = [
            {"id": "task-1", "files": ["a.py"]},
            {"id": "task-2", "files": ["b.py"]},
        ]
        _, conflicts = build_file_ownership(tasks)
        assert conflicts == {}

    def test_detects_shared_file(self):
        tasks = [
            {"id": "task-1", "files": ["shared.py"]},
            {"id": "task-2", "files": ["shared.py"]},
        ]
        _, conflicts = build_file_ownership(tasks)
        assert "shared.py" in conflicts
        assert set(conflicts["shared.py"]) == {"task-1", "task-2"}


class TestInjectConflictEdges:
    def test_adds_dependency_for_shared_file(self):
        tasks = [
            {"id": "task-1", "files": ["shared.py"], "depends_on": []},
            {"id": "task-2", "files": ["shared.py"], "depends_on": []},
        ]
        inject_conflict_edges(tasks)
        assert "task-1" in tasks[1]["depends_on"]

    def test_first_claimant_gets_no_extra_dep(self):
        tasks = [
            {"id": "task-1", "files": ["shared.py"], "depends_on": []},
            {"id": "task-2", "files": ["shared.py"], "depends_on": []},
        ]
        inject_conflict_edges(tasks)
        assert tasks[0]["depends_on"] == []

    def test_no_duplicate_edges(self):
        tasks = [
            {"id": "task-1", "files": ["a.py", "b.py"], "depends_on": []},
            {"id": "task-2", "files": ["a.py", "b.py"], "depends_on": []},
        ]
        inject_conflict_edges(tasks)
        assert tasks[1]["depends_on"].count("task-1") == 1

    def test_three_way_conflict_chains(self):
        tasks = [
            {"id": "task-1", "files": ["shared.py"], "depends_on": []},
            {"id": "task-2", "files": ["shared.py"], "depends_on": []},
            {"id": "task-3", "files": ["shared.py"], "depends_on": []},
        ]
        inject_conflict_edges(tasks)
        assert "task-1" in tasks[1]["depends_on"]
        assert "task-1" in tasks[2]["depends_on"]

    def test_no_self_edges(self):
        tasks = [
            {"id": "task-1", "files": ["a.py"], "depends_on": []},
        ]
        inject_conflict_edges(tasks)
        assert "task-1" not in tasks[0]["depends_on"]

    def test_preserves_existing_deps(self):
        tasks = [
            {"id": "task-1", "files": ["shared.py"], "depends_on": []},
            {"id": "task-2", "files": ["shared.py"], "depends_on": ["task-0"]},
        ]
        inject_conflict_edges(tasks)
        assert "task-0" in tasks[1]["depends_on"]
        assert "task-1" in tasks[1]["depends_on"]


class TestInjectReadDependencyEdges:
    """#280: a lane that only reads a file another lane writes must depend
    on that writer, even though no file-conflict edge would be created
    (build_file_ownership only sees the `files` write list)."""

    def test_reader_depends_on_writer(self):
        tasks = [
            {
                "id": "task-writer",
                "files": ["Domain/Protocol.swift"],
                "reads": [],
                "depends_on": [],
            },
            {
                "id": "task-reader",
                "files": ["UseCase.swift"],
                "reads": ["Domain/Protocol.swift"],
                "depends_on": [],
            },
        ]
        inject_read_dependency_edges(tasks)
        assert "task-writer" in tasks[1]["depends_on"]

    def test_writer_gets_no_dependency_from_its_own_write(self):
        tasks = [
            {
                "id": "task-writer",
                "files": ["Domain/Protocol.swift"],
                "reads": [],
                "depends_on": [],
            },
        ]
        inject_read_dependency_edges(tasks)
        assert tasks[0]["depends_on"] == []

    def test_no_read_dependency_when_file_is_unowned(self):
        tasks = [
            {
                "id": "task-reader",
                "files": ["UseCase.swift"],
                "reads": ["Nowhere.swift"],
                "depends_on": [],
            },
        ]
        inject_read_dependency_edges(tasks)
        assert tasks[0]["depends_on"] == []

    def test_reading_own_write_file_is_not_a_dependency(self):
        tasks = [
            {"id": "task-1", "files": ["a.py"], "reads": ["a.py"], "depends_on": []},
        ]
        inject_read_dependency_edges(tasks)
        assert tasks[0]["depends_on"] == []

    def test_no_duplicate_read_edges(self):
        tasks = [
            {
                "id": "task-writer",
                "files": ["a.py", "b.py"],
                "reads": [],
                "depends_on": [],
            },
            {
                "id": "task-reader",
                "files": ["c.py"],
                "reads": ["a.py", "b.py"],
                "depends_on": [],
            },
        ]
        inject_read_dependency_edges(tasks)
        assert tasks[1]["depends_on"].count("task-writer") == 1

    def test_missing_reads_field_defaults_to_no_edges(self):
        tasks = [
            {"id": "task-writer", "files": ["a.py"], "depends_on": []},
            {"id": "task-reader", "files": ["b.py"], "depends_on": []},
        ]
        inject_read_dependency_edges(tasks)
        assert tasks[1]["depends_on"] == []

    def test_preserves_existing_deps(self):
        tasks = [
            {"id": "task-writer", "files": ["a.py"], "reads": [], "depends_on": []},
            {
                "id": "task-reader",
                "files": ["b.py"],
                "reads": ["a.py"],
                "depends_on": ["task-0"],
            },
        ]
        inject_read_dependency_edges(tasks)
        assert "task-0" in tasks[1]["depends_on"]
        assert "task-writer" in tasks[1]["depends_on"]
