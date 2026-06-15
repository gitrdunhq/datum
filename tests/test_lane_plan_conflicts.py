"""Tests for file-conflict → depends_on edge injection (#159, #163)."""

from datum.lane_plan import build_file_ownership, inject_conflict_edges


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
