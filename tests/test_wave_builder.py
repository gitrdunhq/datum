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


class TestTask002MissingDependency:
    """AC3: MissingDependencyError is importable from datum.wave_builder."""

    def test_ac3_missing_dependency_error_is_importable(self):
        """MissingDependencyError must be importable from datum.wave_builder."""
        from datum.wave_builder import MissingDependencyError

        # Must be a class and must be a subclass of Exception
        assert isinstance(MissingDependencyError, type)
        assert issubclass(MissingDependencyError, Exception)


class TestTask002MissingDependencyAC1:
    """AC1: build_waves raises MissingDependencyError with the missing id in the message."""

    def test_ac1_unknown_dependency_raises_missing_dependency_error(self):
        """build_waves({'a': {'depends_on': ['nonexistent']}}) must raise MissingDependencyError."""
        from datum.wave_builder import MissingDependencyError, build_waves

        with pytest.raises(MissingDependencyError):
            build_waves({"a": {"depends_on": ["nonexistent"]}})

    def test_ac1_error_message_contains_missing_id(self):
        """The MissingDependencyError message must contain the missing dependency id 'nonexistent'."""
        from datum.wave_builder import MissingDependencyError, build_waves

        with pytest.raises(MissingDependencyError) as exc_info:
            build_waves({"a": {"depends_on": ["nonexistent"]}})

        assert "nonexistent" in str(exc_info.value)

    def test_ac1_not_a_generic_value_error(self):
        """MissingDependencyError must NOT be a plain ValueError — must be the specific type."""
        from datum.wave_builder import MissingDependencyError, build_waves

        try:
            build_waves({"a": {"depends_on": ["ghost"]}})
            pytest.fail("Expected MissingDependencyError was not raised")
        except MissingDependencyError as exc:
            # Confirm the caught exception is the exact type, not a generic ValueError
            assert type(exc).__name__ == "MissingDependencyError"
            assert "ghost" in str(exc)
        except Exception as exc:
            pytest.fail(
                f"Expected MissingDependencyError but got {type(exc).__name__}: {exc}"
            )


class TestTask002ValidDependency:
    """AC2: build_waves does NOT raise when all dependencies exist (regression check)."""

    def test_ac2_valid_dependency_does_not_raise(self):
        """build_waves({'a': {'depends_on': ['b']}, 'b': {}}) must NOT raise any exception."""
        from datum.wave_builder import build_waves

        # Should complete without raising — 'b' exists in lanes
        result = build_waves({"a": {"depends_on": ["b"]}, "b": {}})
        assert result is not None

    def test_ac2_valid_dependency_produces_correct_wave_order(self):
        """With a -> b dependency, 'b' must appear in an earlier wave than 'a'."""
        from datum.wave_builder import build_waves

        result = build_waves({"a": {"depends_on": ["b"]}, "b": {}})

        waves = list(result)
        # 'b' has no dependencies → must be in wave 0
        assert "b" in waves[0], f"Expected 'b' in wave 0, got waves={waves}"
        # 'a' depends on 'b' → must be in a later wave
        flat = [task for wave in waves for task in wave]
        b_idx = flat.index("b")
        a_idx = flat.index("a")
        assert (
            b_idx < a_idx
        ), f"Expected 'b' before 'a', got b_idx={b_idx}, a_idx={a_idx}"


# ---------------------------------------------------------------------------
# task-001 RED tests: cycle_path attribute on CyclicDependencyError
# These tests require CyclicDependencyError to expose a structured cycle_path
# attribute (list[str]) that is NOT yet implemented.
# ---------------------------------------------------------------------------


class TestTask001CyclePathAttribute:
    """AC1 + AC2 extended: CyclicDependencyError must expose a structured
    .cycle_path attribute (list[str]) showing the exact cycle as an ordered
    path, e.g. ['a', 'b', 'a'] for a two-node cycle.

    The current implementation only exposes .cycle_nodes (unordered set of
    participating nodes) but NOT a .cycle_path attribute on the exception.
    """

    def test_ac1_exception_has_cycle_path_attribute(self):
        """CyclicDependencyError raised for a 2-node cycle must have a
        .cycle_path attribute that is a non-empty list.
        """
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        err = exc_info.value
        assert hasattr(err, "cycle_path"), (
            "CyclicDependencyError must expose a 'cycle_path' attribute "
            "(list[str] showing the ordered cycle path). Got attributes: "
            f"{[a for a in dir(err) if not a.startswith('__')]}"
        )
        assert isinstance(
            err.cycle_path, list
        ), f"cycle_path must be a list, got {type(err.cycle_path).__name__}"
        assert (
            len(err.cycle_path) >= 2
        ), f"cycle_path must have at least 2 elements, got: {err.cycle_path!r}"

    def test_ac1_two_node_cycle_path_is_closed_loop(self):
        """For a 2-node cycle (a -> b -> a), cycle_path must start and end
        with the same node, forming a closed loop like ['a', 'b', 'a'].
        """
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        err = exc_info.value
        path = err.cycle_path
        assert path[0] == path[-1], (
            f"cycle_path must be a closed loop (first == last). " f"Got: {path!r}"
        )

    def test_ac1_two_node_cycle_path_contains_both_nodes(self):
        """cycle_path for a 2-node cycle must contain both 'a' and 'b'."""
        lanes = {"a": {"depends_on": ["b"]}, "b": {"depends_on": ["a"]}}
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        err = exc_info.value
        path_nodes = set(err.cycle_path)
        assert (
            "a" in path_nodes and "b" in path_nodes
        ), f"cycle_path must include both 'a' and 'b'. Got: {err.cycle_path!r}"

    def test_ac2_three_node_cycle_path_has_correct_length(self):
        """For a 3-node cycle (a -> b -> c -> a), cycle_path must have exactly
        4 elements (3 distinct nodes + the repeated start node to close the loop).
        """
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        err = exc_info.value
        path = err.cycle_path
        assert len(path) == 4, (
            f"3-node cycle_path must have 4 elements (3 nodes + repeated start). "
            f"Got {len(path)} elements: {path!r}"
        )

    def test_ac2_three_node_cycle_path_contains_all_nodes(self):
        """cycle_path for a 3-node cycle must contain 'a', 'b', and 'c'."""
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        err = exc_info.value
        path_nodes = set(err.cycle_path)
        assert {"a", "b", "c"} == path_nodes, (
            f"cycle_path must include all three nodes {{'a', 'b', 'c'}}. "
            f"Got: {err.cycle_path!r}"
        )

    def test_ac2_three_node_cycle_path_is_closed_loop(self):
        """For a 3-node cycle, cycle_path must start and end with the same node."""
        lanes = {
            "a": {"depends_on": ["b"]},
            "b": {"depends_on": ["c"]},
            "c": {"depends_on": ["a"]},
        }
        with pytest.raises(CyclicDependencyError) as exc_info:
            build_waves(lanes)
        err = exc_info.value
        path = err.cycle_path
        assert path[0] == path[-1], (
            f"cycle_path must be a closed loop (first == last). " f"Got: {path!r}"
        )


# ---------------------------------------------------------------------------
# RED tests for task-002: structured attributes on MissingDependencyError
# Traceability:
#   AC1-struct → test_ac1_missing_dependency_error_exposes_missing_id_attribute
#   AC1-struct → test_ac1_missing_dependency_error_exposes_lane_id_attribute
#   AC1-struct → test_ac1_multiple_missing_deps_reports_first_missing
#   AC2-regression → test_ac2_no_exception_on_self_contained_graph
#   AC3-strict → test_ac3_missing_dependency_error_not_value_error_subclass
# ---------------------------------------------------------------------------


class TestTask002MissingDependencyStructuredAttributes:
    """AC1 (strict): MissingDependencyError must expose structured attributes
    so callers can inspect *which* dependency is missing and *which* lane
    declared it — not just parse the human-readable message.

    These tests are RED because the current implementation raises a bare
    MissingDependencyError(ValueError) with no structured fields.
    """

    def test_ac1_missing_dependency_error_exposes_missing_id_attribute(self):
        """MissingDependencyError must carry a .missing_id attribute set to
        the exact string of the missing dependency ('nonexistent').

        RED: current implementation has no .missing_id attribute.
        """
        from datum.wave_builder import MissingDependencyError, build_waves

        with pytest.raises(MissingDependencyError) as exc_info:
            build_waves({"a": {"depends_on": ["nonexistent"]}})

        err = exc_info.value
        assert hasattr(err, "missing_id"), (
            "MissingDependencyError must expose a .missing_id attribute "
            f"but got: {dir(err)}"
        )
        assert (
            err.missing_id == "nonexistent"
        ), f"Expected err.missing_id == 'nonexistent', got: {err.missing_id!r}"

    def test_ac1_missing_dependency_error_exposes_lane_id_attribute(self):
        """MissingDependencyError must carry a .lane_id attribute set to
        the ID of the lane that declared the bad dependency ('a').

        RED: current implementation has no .lane_id attribute.
        """
        from datum.wave_builder import MissingDependencyError, build_waves

        with pytest.raises(MissingDependencyError) as exc_info:
            build_waves({"a": {"depends_on": ["nonexistent"]}})

        err = exc_info.value
        assert hasattr(err, "lane_id"), (
            "MissingDependencyError must expose a .lane_id attribute "
            f"but got: {dir(err)}"
        )
        assert err.lane_id == "a", f"Expected err.lane_id == 'a', got: {err.lane_id!r}"

    def test_ac1_multiple_missing_deps_reports_first_alphabetically(self):
        """When multiple lanes have missing deps, the error should identify
        the first offending dependency found (deterministic ordering).

        RED: current implementation does not expose .missing_id at all.
        """
        from datum.wave_builder import MissingDependencyError, build_waves

        lanes = {
            "x": {"depends_on": ["ghost_x"]},
        }
        with pytest.raises(MissingDependencyError) as exc_info:
            build_waves(lanes)

        err = exc_info.value
        assert hasattr(
            err, "missing_id"
        ), "MissingDependencyError must expose .missing_id"
        assert (
            err.missing_id == "ghost_x"
        ), f"Expected err.missing_id == 'ghost_x', got: {err.missing_id!r}"


class TestTask002MissingDependencyRegressionStrict:
    """AC2 (strict): valid dependency graph must not only not raise, but also
    return a WaveResult with a usable .to_dict() representation.

    RED: WaveResult has no .to_dict() method.
    """

    def test_ac2_wave_result_exposes_to_dict(self):
        """WaveResult returned from a valid graph must support .to_dict()
        so callers can serialise the plan.

        RED: WaveResult has no .to_dict() method.
        """
        from datum.wave_builder import build_waves

        result = build_waves({"a": {"depends_on": ["b"]}, "b": {}})
        assert hasattr(result, "to_dict"), "WaveResult must expose a .to_dict() method"
        d = result.to_dict()
        assert isinstance(d, dict), f"to_dict() must return a dict, got: {type(d)}"
        assert "waves" in d, f"to_dict() result must have 'waves' key, got: {d!r}"
