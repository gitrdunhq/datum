"""Tests for Kahn's algorithm, DDI injection, and cycle detection in lane_plan.py."""

import pytest
from datum.lane_plan import kahn_sort, inject_ddi_dependencies, inject_conflict_edges


class TestKahnsSort:
    """Test Kahn's algorithm topological sort with cycle detection."""

    def test_linear_chain(self):
        """A -> B -> C should produce [A, B, C]."""
        tasks = [
            {"id": "A", "depends_on": []},
            {"id": "B", "depends_on": ["A"]},
            {"id": "C", "depends_on": ["B"]},
        ]
        result = kahn_sort(tasks)
        assert result["order"] == ["A", "B", "C"]
        assert result["cyclic"] == []
        assert result["has_cycles"] is False

    def test_diamond(self):
        """A -> B, A -> C, B -> D, C -> D."""
        tasks = [
            {"id": "A", "depends_on": []},
            {"id": "B", "depends_on": ["A"]},
            {"id": "C", "depends_on": ["A"]},
            {"id": "D", "depends_on": ["B", "C"]},
        ]
        result = kahn_sort(tasks)
        assert result["order"][0] == "A"
        assert result["order"][-1] == "D"
        assert result["cyclic"] == []
        assert result["has_cycles"] is False

    def test_parallel_lanes(self):
        """Independent tasks should be lexicographically ordered."""
        tasks = [
            {"id": "C", "depends_on": []},
            {"id": "A", "depends_on": []},
            {"id": "B", "depends_on": []},
        ]
        result = kahn_sort(tasks)
        assert result["order"] == ["A", "B", "C"]
        assert result["has_cycles"] is False

    def test_cycle_detection(self):
        """A <-> B should be detected as cyclic."""
        tasks = [
            {"id": "A", "depends_on": ["B"]},
            {"id": "B", "depends_on": ["A"]},
        ]
        result = kahn_sort(tasks)
        assert result["has_cycles"] is True
        assert set(result["cyclic"]) == {"A", "B"}
        # Fallback order should still contain all nodes
        assert set(result["order"]) == {"A", "B"}

    def test_partial_cycle(self):
        """A -> B <-> C: only B and C are cyclic."""
        tasks = [
            {"id": "A", "depends_on": []},
            {"id": "B", "depends_on": ["C"]},
            {"id": "C", "depends_on": ["B"]},
        ]
        result = kahn_sort(tasks)
        assert result["has_cycles"] is True
        assert set(result["cyclic"]) == {"B", "C"}
        assert "A" in result["order"]

    def test_no_deps(self):
        """Tasks with no dependencies are all zero-in-degree."""
        tasks = [
            {"id": "B", "depends_on": []},
            {"id": "A", "depends_on": []},
        ]
        result = kahn_sort(tasks)
        assert result["order"] == ["A", "B"]
        assert result["has_cycles"] is False

    def test_ignores_unknown_deps(self):
        """Dependencies on non-existent tasks should be ignored."""
        tasks = [
            {"id": "A", "depends_on": ["X", "Y"]},
        ]
        result = kahn_sort(tasks)
        assert result["order"] == ["A"]
        assert result["has_cycles"] is False


class TestDdiDependencies:
    """Test DDI (Dependency Derivation Input) manifest injection."""

    def test_basic_injection(self):
        """DDI should inject depends_on edges based on file ownership."""
        tasks = [
            {"id": "t1", "files": ["a.js"]},
            {"id": "t2", "files": ["b.js"]},
            {"id": "t3", "files": ["c.js"]},
        ]
        dependencies = {
            "b.js": ["a.js"],
            "c.js": ["a.js", "b.js"],
        }
        injected = inject_ddi_dependencies(tasks, dependencies)
        assert injected == 3

        t2_deps = tasks[1].get("depends_on", [])
        assert "t1" in t2_deps

        t3_deps = tasks[2].get("depends_on", [])
        assert "t1" in t3_deps
        assert "t2" in t3_deps

    def test_no_matching_files(self):
        """DDI with no matching files should inject 0 edges."""
        tasks = [{"id": "t1", "files": ["a.js"]}]
        dependencies = {"x.js": ["y.js"]}
        assert inject_ddi_dependencies(tasks, dependencies) == 0

    def test_self_ref_ignored(self):
        """A file importing itself should be ignored."""
        tasks = [{"id": "t1", "files": ["a.js"]}]
        dependencies = {"a.js": ["a.js"]}
        assert inject_ddi_dependencies(tasks, dependencies) == 0

    def test_partial_match(self):
        """Only matching files should get edges injected."""
        tasks = [
            {"id": "t1", "files": ["a.js"]},
            {"id": "t2", "files": ["b.js"]},
        ]
        dependencies = {
            "b.js": ["a.js"],
            "x.js": ["y.js"],  # no match
        }
        injected = inject_ddi_dependencies(tasks, dependencies)
        assert injected == 1
        assert tasks[1].get("depends_on") == ["t1"]

    def test_no_duplicates(self):
        """Already existing deps should not be duplicated."""
        tasks = [{"id": "t2", "files": ["b.js"], "depends_on": ["t1"]}]
        dependencies = {"b.js": ["a.js"]}  # t1 owns a.js
        injected = inject_ddi_dependencies(tasks, dependencies)
        assert injected == 0
        assert tasks[0].get("depends_on") == ["t1"]


class TestCycleRisk:
    """Test that cycle_risk field is set correctly in lane plan."""

    def test_no_cycle_risk_when_no_cycles(self):
        """Tasks should have cycle_risk=False when no cycles exist."""
        from datum.lane_plan import build_lane_plan, build_file_ownership, inject_conflict_edges

        tasks = [
            {"id": "t1", "files": ["a.js"], "title": "A", "acceptance_criteria": [], "red_note": ""},
            {"id": "t2", "files": ["b.js"], "title": "B", "acceptance_criteria": [], "red_note": "", "depends_on": ["t1"]},
        ]
        inject_conflict_edges(tasks)
        sort_result = kahn_sort(tasks)
        ownership, _ = build_file_ownership(tasks)
        plan = build_lane_plan(tasks, sort_result["order"], ownership, cyclic=sort_result["cyclic"])

        assert plan["lanes"]["t1"]["cycle_risk"] is False
        assert plan["lanes"]["t2"]["cycle_risk"] is False

    def test_cycle_risk_set_for_cyclic_tasks(self):
        """Tasks in cycles should have cycle_risk=True."""
        from datum.lane_plan import build_lane_plan, build_file_ownership, inject_conflict_edges

        tasks = [
            {"id": "t1", "files": ["a.js"], "title": "A", "acceptance_criteria": [], "red_note": "", "depends_on": ["t2"]},
            {"id": "t2", "files": ["b.js"], "title": "B", "acceptance_criteria": [], "red_note": "", "depends_on": ["t1"]},
        ]
        inject_conflict_edges(tasks)
        sort_result = kahn_sort(tasks)
        ownership, _ = build_file_ownership(tasks)
        plan = build_lane_plan(tasks, sort_result["order"], ownership, cyclic=sort_result["cyclic"])

        assert plan["lanes"]["t1"]["cycle_risk"] is True
        assert plan["lanes"]["t2"]["cycle_risk"] is True
