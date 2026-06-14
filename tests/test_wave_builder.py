# RED tests for task-001: cycle detection with cycle path in error message
# Traceability:
#   AC1 → test_ac1_two_node_cycle_raises_with_both_ids
#   AC2 → test_ac2_three_node_cycle_raises_with_all_ids
#   AC3 → test_ac3_valid_dag_returns_wave_result_with_two_waves
#   AC4 → test_ac4_cyclicdependencyerror_is_importable

import pytest

from datum.wave_builder import CyclicDependencyError, WaveResult, build_waves


class TestTask001CycleDetection:
    """AC1: build_waves({'a': {'depends_on': ['b']}, 'b': {'depends_on': ['a']}})
    raises CyclicDependencyError with both 'a' and 'b' in the error message.
    """

    def test_ac1_two_node_cycle_raises_cyclic_dependency_error(self):
        """Two-node cycle must raise CyclicDependencyError — not a generic ValueError."""
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError):
            build_waves(lanes)

    def test_ac1_two_node_cycle_error_message_contains_a(self):
        """Error message must contain task ID 'a'."""
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        assert "a" in str(exc_info.value)

    def test_ac1_two_node_cycle_error_message_contains_b(self):
        """Error message must contain task ID 'b'."""
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        assert "b" in str(exc_info.value)

    def test_ac1_two_node_cycle_error_message_contains_cycle_path(self):
        """Error message must show the directed cycle path using '->' notation
        so the caller can see the exact cycle, not just a node list.

        Expected format: something like 'a -> b -> a' (path showing the loop).
        Current implementation only lists nodes; path notation is not yet implemented.
        """
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        msg = str(exc_info.value)
        assert (
            "->" in msg
        ), f"Error message must contain '->' cycle path notation, got: {msg!r}"


class TestTask001ThreeNodeCycle:
    """AC2: build_waves({'a': {'depends_on': ['b']}, 'b': {'depends_on': ['c']},
    'c': {'depends_on': ['a']}}) raises CyclicDependencyError with all three
    task IDs in the message.
    """

    def test_ac2_three_node_cycle_raises_cyclic_dependency_error(self):
        """Three-node cycle must raise CyclicDependencyError."""
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError):
            build_waves(lanes)

    def test_ac2_three_node_cycle_error_message_contains_a(self):
        """Error message must contain task ID 'a'."""
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        assert "a" in str(exc_info.value)

    def test_ac2_three_node_cycle_error_message_contains_b(self):
        """Error message must contain task ID 'b'."""
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        assert "b" in str(exc_info.value)

    def test_ac2_three_node_cycle_error_message_contains_c(self):
        """Error message must contain task ID 'c'."""
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        assert "c" in str(exc_info.value)

    def test_ac2_three_node_cycle_error_message_contains_cycle_path(self):
        """Error message must show the directed cycle path using '->' notation.

        Expected format: something like 'a -> b -> c -> a' showing the full loop.
        Current implementation only lists node names; path notation not yet implemented.
        """
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        msg = str(exc_info.value)
        assert (
            "->" in msg
        ), f"Error message must contain '->' cycle path notation, got: {msg!r}"


class TestTask001RegressionValidDag:
    """AC3: build_waves({'a': {}, 'b': {'depends_on': ['a']}}) returns a valid
    WaveResult with 2 waves and no error (regression check).
    """

    def test_ac3_valid_dag_returns_wave_result_instance(self):
        """Valid DAG must return a WaveResult, not raise."""
        lanes = {"a": {}, "b": {"depends_on": ["a"]}}
        result = build_waves(lanes)
        assert isinstance(result, WaveResult)

    def test_ac3_valid_dag_returns_exactly_two_waves(self):
        """WaveResult must report exactly 2 waves for this two-level DAG."""
        lanes = {"a": {}, "b": {"depends_on": ["a"]}}
        result = build_waves(lanes)
        assert (
            len(result.waves) == 2
        ), f"Expected 2 waves, got {len(result.waves)}: {result.waves}"

    def test_ac3_valid_dag_wave_zero_contains_a(self):
        """First wave (no dependencies) must contain task 'a'."""
        lanes = {"a": {}, "b": {"depends_on": ["a"]}}
        result = build_waves(lanes)
        assert "a" in result.waves[0], f"Expected 'a' in wave 0, got: {result.waves[0]}"

    def test_ac3_valid_dag_wave_one_contains_b(self):
        """Second wave (depends on 'a') must contain task 'b'."""
        lanes = {"a": {}, "b": {"depends_on": ["a"]}}
        result = build_waves(lanes)
        assert "b" in result.waves[1], f"Expected 'b' in wave 1, got: {result.waves[1]}"

    def test_ac3_wave_result_cycle_path_attribute(self):
        """WaveResult must expose a .cycle_path property (None for valid DAGs).

        This attribute does not yet exist on WaveResult — RED failure expected.
        """
        lanes = {"a": {}, "b": {"depends_on": ["a"]}}
        result = build_waves(lanes)
        # cycle_path should be None for acyclic graphs
        assert (
            result.cycle_path is None
        ), f"Expected result.cycle_path to be None, got: {result.cycle_path!r}"


class TestTask001CyclicDependencyErrorImportable:
    """AC4: CyclicDependencyError is importable from datum.wave_builder."""

    def test_ac4_cyclicdependencyerror_is_importable(self):
        """CyclicDependencyError must be importable from datum.wave_builder."""
        from datum.wave_builder import CyclicDependencyError as CDE

        assert CDE is not None

    def test_ac4_cyclicdependencyerror_is_value_error_subclass(self):
        """CyclicDependencyError must be a subclass of ValueError."""
        from datum.wave_builder import CyclicDependencyError as CDE

        assert issubclass(CDE, ValueError)

    def test_ac4_cyclicdependencyerror_exposes_cycle_nodes_attribute(self):
        """CyclicDependencyError instance must expose a .cycle_nodes attribute
        listing the nodes participating in the cycle.

        This attribute does not yet exist on CyclicDependencyError — RED failure expected.
        """
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        err = exc_info.value
        assert hasattr(
            err, "cycle_nodes"
        ), "CyclicDependencyError must have a 'cycle_nodes' attribute listing cycle participants"
        assert set(err.cycle_nodes) == {
            "a",
            "b",
        }, f"Expected cycle_nodes={{'a', 'b'}}, got: {err.cycle_nodes!r}"
