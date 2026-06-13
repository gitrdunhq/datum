# RED tests for task-001: validate_lane_plan — structural validation before build_waves
# Traceability: AC1-AC4 → tests/test_wave_builder.py

import pytest


class TestTask_001_AC4:
    def test_ac4_ac4_validatelaneplan_is_importable_from_datumwavebuilder(self):
        """
        AC4: validate_lane_plan is importable from datum.wave_builder
        """
        # Act — will raise ImportError if the symbol does not exist
        from datum.wave_builder import validate_lane_plan

        # Assert — function must be callable
        assert callable(validate_lane_plan)


class TestTask_001_AC1:
    """AC1: validate_lane_plan raises ValueError if a lane is missing 'id' or 'files' keys."""

    def test_ac1_missing_id_key_raises_value_error(self):
        """Lane dict without 'id' key must raise ValueError."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [{"files": ["a.py"]}],  # no 'id'
            "topological_order": [],
        }
        with pytest.raises(ValueError):
            validate_lane_plan(plan)

    def test_ac1_missing_files_key_raises_value_error(self):
        """Lane dict without 'files' key must raise ValueError."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [{"id": "lane-1"}],  # no 'files'
            "topological_order": ["lane-1"],
        }
        with pytest.raises(ValueError):
            validate_lane_plan(plan)

    def test_ac1_missing_both_id_and_files_raises_value_error(self):
        """Lane dict with neither 'id' nor 'files' must raise ValueError."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [{"depends_on": []}],
            "topological_order": [],
        }
        with pytest.raises(ValueError):
            validate_lane_plan(plan)


class TestTask_001_AC2:
    """AC2: validate_lane_plan raises ValueError if topological_order contains IDs not in lanes."""

    def test_ac2_orphan_topo_id_raises_value_error(self):
        """topological_order referencing an ID absent from lanes must raise ValueError."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [{"id": "lane-1", "files": ["a.py"]}],
            "topological_order": ["lane-1", "lane-ghost"],  # 'lane-ghost' not in lanes
        }
        with pytest.raises(ValueError):
            validate_lane_plan(plan)

    def test_ac2_entirely_unknown_topo_ids_raise_value_error(self):
        """topological_order with no matching lane IDs must raise ValueError."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [{"id": "lane-A", "files": ["x.py"]}],
            "topological_order": ["lane-X", "lane-Y"],  # neither exists in lanes
        }
        with pytest.raises(ValueError):
            validate_lane_plan(plan)


class TestTask_001_AC3:
    """AC3: validate_lane_plan returns None silently for a valid plan."""

    def test_ac3_valid_plan_returns_none(self):
        """A structurally valid plan must return None with no exception."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [
                {"id": "lane-1", "files": ["a.py"]},
                {"id": "lane-2", "files": ["b.py"]},
            ],
            "topological_order": ["lane-1", "lane-2"],
        }
        result = validate_lane_plan(plan)
        assert result is None

    def test_ac3_valid_plan_with_empty_topological_order_returns_none(self):
        """A valid plan where topological_order is empty must return None."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [{"id": "lane-1", "files": ["a.py"]}],
            "topological_order": [],
        }
        result = validate_lane_plan(plan)
        assert result is None

    def test_ac3_valid_plan_with_no_lanes_returns_none(self):
        """An empty lanes list with empty topological_order is a valid (trivial) plan."""
        from datum.wave_builder import validate_lane_plan

        plan = {
            "lanes": [],
            "topological_order": [],
        }
        result = validate_lane_plan(plan)
        assert result is None
