"""Tests for the file-overlap dependency check in gate_plan() (#524 dogfooding).

The file-overlap check in gate_plan() computed a transitive closure over
`depends_on` for units, but used only the raw direct `depends_on` list for
tasks. A chain like task-009 -> task-007 -> task-006 (each one a direct
edge) means task-009 is transitively guaranteed to run after task-006, but
the direct-only check couldn't see that: it raised a false "File overlap
... no dependency edge" whenever three or more tasks touched the same file
with ordering established through an intermediate task rather than a
single direct edge — a completely normal pattern for lanes that write the
same core file across several sequential precedence-wiring steps.
"""

from __future__ import annotations

from datum.gate import _transitive_closure


class TestTransitiveClosure:
    def test_direct_dependency_is_preserved(self):
        deps = {"a": {"b"}, "b": set()}
        result = _transitive_closure(deps)
        assert result["a"] == {"b"}

    def test_transitive_chain_is_expanded(self):
        # a -> b -> c: a must end up depending on both b and c
        deps = {"a": {"b"}, "b": {"c"}, "c": set()}
        result = _transitive_closure(deps)
        assert result["a"] == {"b", "c"}
        assert result["b"] == {"c"}

    def test_longer_chain_matching_the_reported_bug(self):
        # task-009 -> task-007 -> task-006, plus task-009's other direct deps
        deps = {
            "task-009": {"task-007", "task-008", "task-005"},
            "task-007": {"task-006"},
            "task-008": set(),
            "task-005": set(),
            "task-006": set(),
        }
        result = _transitive_closure(deps)
        assert "task-006" in result["task-009"]

    def test_no_dependencies_stays_empty(self):
        deps = {"a": set(), "b": set()}
        result = _transitive_closure(deps)
        assert result["a"] == set()
        assert result["b"] == set()

    def test_a_dependency_on_an_unknown_id_is_left_alone(self):
        # a depends on "ghost", which isn't a key in the map at all
        deps = {"a": {"ghost"}}
        result = _transitive_closure(deps)
        assert result["a"] == {"ghost"}

    def test_mutates_and_returns_the_same_dict(self):
        deps = {"a": {"b"}, "b": {"c"}, "c": set()}
        result = _transitive_closure(deps)
        assert result is deps


class TestFileOverlapTransitiveTaskDependency:
    """Exercises the pairwise file-overlap check's task-level branch
    directly, without going through the full gate_plan() CLI/schema/file
    plumbing — mirrors the shape of the check in gate_plan() (#524)."""

    def _file_overlap_would_fail(
        self, lanes: dict[str, dict], f: str, t1: str, t2: str
    ) -> bool:
        task_deps = {
            lid: set(lane.get("depends_on", [])) for lid, lane in lanes.items()
        }
        task_deps = _transitive_closure(task_deps)
        return not (t2 in task_deps.get(t1, set()) or t1 in task_deps.get(t2, set()))

    def test_direct_edge_does_not_false_fail(self):
        lanes = {
            "task-006": {"depends_on": []},
            "task-007": {"depends_on": ["task-006"]},
        }
        assert not self._file_overlap_would_fail(
            lanes, "part_stock.py", "task-006", "task-007"
        )

    def test_transitive_edge_through_an_intermediate_task_does_not_false_fail(self):
        # This is the exact reported shape: task-009 depends_on task-007
        # (among others), task-007 depends_on task-006 directly — task-009
        # and task-006 share no direct edge, only a transitive one.
        lanes = {
            "task-005": {"depends_on": []},
            "task-006": {"depends_on": []},
            "task-007": {"depends_on": ["task-006"]},
            "task-008": {"depends_on": []},
            "task-009": {"depends_on": ["task-007", "task-008", "task-005"]},
        }
        assert not self._file_overlap_would_fail(
            lanes, "part_stock.py", "task-006", "task-009"
        )

    def test_genuinely_unordered_tasks_still_fail(self):
        # No path either direction — a real conflict, must still be caught.
        lanes = {
            "task-a": {"depends_on": []},
            "task-b": {"depends_on": []},
        }
        assert self._file_overlap_would_fail(lanes, "shared.py", "task-a", "task-b")
