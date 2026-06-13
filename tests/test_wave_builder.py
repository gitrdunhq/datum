"""Tests for task-002: Missing dependency detection in wave_builder.

AC2: build_waves with a reference to a nonexistent lane raises MissingDependencyError
AC3: Existing valid DAGs still work identically (no regression)
AC4: MissingDependencyError is importable from datum.wave_builder

RED NOTE: MissingDependencyError does not exist yet in datum.wave_builder.
All tests importing or expecting it will fail until GREEN agent adds it.
"""

import pytest

from datum.wave_builder import MissingDependencyError, build_waves


class TestAC4_MissingDependencyErrorImportable:
    """AC4: MissingDependencyError must be importable from datum.wave_builder."""

    def test_missing_dependency_error_is_a_class(self):
        """MissingDependencyError should be a class (not None, not a function)."""
        assert isinstance(MissingDependencyError, type)

    def test_missing_dependency_error_is_exception_subclass(self):
        """MissingDependencyError should inherit from Exception."""
        assert issubclass(MissingDependencyError, Exception)


class TestAC2_MissingDependencyRaisesError:
    """AC2: build_waves with a reference to a nonexistent lane raises MissingDependencyError."""

    def test_single_nonexistent_dependency_raises(self):
        """Lane 'a' depends on 'nonexistent' which is not a key in lanes."""
        lanes = {"a": {"depends_on": ["nonexistent"]}}
        with pytest.raises(MissingDependencyError):
            build_waves(lanes)

    def test_error_message_mentions_missing_dep(self):
        """The error message should name the missing dependency."""
        lanes = {"a": {"depends_on": ["ghost"]}}
        with pytest.raises(MissingDependencyError, match="ghost"):
            build_waves(lanes)

    def test_multiple_nonexistent_dependencies_raises(self):
        """Lane depending on two nonexistent lanes should also raise."""
        lanes = {"a": {"depends_on": ["x", "y"]}}
        with pytest.raises(MissingDependencyError):
            build_waves(lanes)

    def test_one_valid_one_missing_dep_raises(self):
        """A lane with mixed valid + nonexistent deps should raise."""
        lanes = {
            "a": {},
            "b": {"depends_on": ["a", "does_not_exist"]},
        }
        with pytest.raises(MissingDependencyError):
            build_waves(lanes)

    def test_currently_silently_ignored_bad_ref(self):
        """
        Regression guard: before the fix build_waves({\"a\": {\"depends_on\": [\"nonexistent\"]}})
        returned [['a']] silently.  After the fix it must raise.
        """
        lanes = {"a": {"depends_on": ["nonexistent"]}}
        with pytest.raises(MissingDependencyError):
            build_waves(lanes)


class TestAC3_ValidDagsNoRegression:
    """AC3: Existing valid DAGs still work identically (no regression)."""

    def test_empty_lanes_returns_empty(self):
        assert build_waves({}) == []

    def test_single_lane_no_deps(self):
        assert build_waves({"a": {}}) == [["a"]]

    def test_linear_chain(self):
        lanes = {
            "a": {},
            "b": {"depends_on": ["a"]},
            "c": {"depends_on": ["b"]},
        }
        assert build_waves(lanes) == [["a"], ["b"], ["c"]]

    def test_parallel_independent_lanes(self):
        lanes = {"a": {}, "b": {}, "c": {}}
        assert build_waves(lanes) == [["a", "b", "c"]]

    def test_diamond_dag(self):
        lanes = {
            "a": {},
            "b": {"depends_on": ["a"]},
            "c": {"depends_on": ["a"]},
            "d": {"depends_on": ["b", "c"]},
        }
        waves = build_waves(lanes)
        assert waves[0] == ["a"]
        assert sorted(waves[1]) == ["b", "c"]
        assert waves[2] == ["d"]

    def test_none_depends_on_treated_as_no_deps(self):
        lanes = {"a": {"depends_on": None}}
        assert build_waves(lanes) == [["a"]]

    def test_empty_depends_on_list(self):
        lanes = {"a": {"depends_on": []}}
        assert build_waves(lanes) == [["a"]]
