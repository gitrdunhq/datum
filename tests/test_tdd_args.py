# Skeleton: task-001 AC4 — PROP-004
# RED agent: fill in the assertion body. Do not rename this function or move this file.
# Traceability: AC4 → test_ac4_ac4_raises_valueerror_with_helpful_message → tests/test_tdd_args.py

import pytest


class TestTask_001_AC4:
    def test_ac4_ac4_raises_valueerror_with_helpful_message(self):
        """
        PROP-004: AC4: Raises ValueError with helpful message if lane_plan_path does not exist
        """
        from datum.tdd_args import build_tdd_args

        # Arrange
        nonexistent_path = "/nonexistent/path/to/lane-plan.json"

        # Act & Assert — prove PROP-004
        with pytest.raises(ValueError, match="lane_plan_path does not exist"):
            build_tdd_args("Test Feature", nonexistent_path, ".")

        # Verify the error message includes guidance
        try:
            build_tdd_args("Test Feature", nonexistent_path, ".")
        except ValueError as e:
            assert "Ensure the lane plan has been generated" in str(e)
            assert nonexistent_path in str(e)
