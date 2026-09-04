"""Tests for tdd_driver.py's verify_red_stage/verify_green_baseline.

Bug: verify_red_stage only checked `returncode == 0` to decide whether the
RED stage produced a genuinely failing test. pytest returns exit code 5
("no tests collected") when zero test items match — e.g. a typo'd test
function name, an empty test file, or a test file that failed to collect
at all. That's != 0, so the old code silently treated "no test ever ran"
as a legitimate RED failure, defeating the entire green-blindness guard:
an agent could write a no-op test file and the RED gate would wave it
through as if a real assertion had failed.

These tests mock subprocess.run — they never touch the real filesystem
or run a real pytest subprocess.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from datum.tdd_driver import (
    DirtyBaselineError,
    GreenBlindnessError,
    verify_green_baseline,
    verify_red_stage,
)


def _completed(
    returncode: int, stdout: str = "", stderr: str = ""
) -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(
        args=["pytest", "-q"], returncode=returncode, stdout=stdout, stderr=stderr
    )


class TestVerifyRedStageGenuineFailure:
    def test_returncode_1_is_accepted_as_valid_red(self, tmp_path: Path):
        """exit 1 (real assertion failure) is the normal, expected RED signal."""
        with patch(
            "subprocess.run",
            return_value=_completed(1, stdout="1 failed, AssertionError: boom"),
        ):
            result = verify_red_stage(tmp_path, test_command=["pytest", "-q"])
        assert result["exit_code"] == 1

    def test_returncode_0_raises_green_blindness(self, tmp_path: Path):
        with patch("subprocess.run", return_value=_completed(0, stdout="3 passed")):
            with pytest.raises(GreenBlindnessError):
                verify_red_stage(tmp_path, test_command=["pytest", "-q"])


class TestVerifyRedStageZeroTestsCollected:
    def test_returncode_5_no_tests_collected_raises_not_silently_accepted(
        self, tmp_path: Path
    ):
        """Bug repro: pytest exit 5 ('no tests ran') must NOT be treated as a
        valid RED failure — it means no test ever executed."""
        with patch(
            "subprocess.run",
            return_value=_completed(5, stdout="no tests ran in 0.00s"),
        ):
            with pytest.raises(GreenBlindnessError) as exc_info:
                verify_red_stage(tmp_path, test_command=["pytest", "-q"])
        msg = str(exc_info.value).lower()
        assert "no tests" in msg or "zero tests" in msg


class TestVerifyGreenBaseline:
    def test_returncode_0_passes_silently(self, tmp_path: Path):
        with patch("subprocess.run", return_value=_completed(0, stdout="5 passed")):
            verify_green_baseline(tmp_path, test_command=["pytest", "-q"])  # no raise

    def test_returncode_1_raises_dirty_baseline(self, tmp_path: Path):
        with patch("subprocess.run", return_value=_completed(1, stdout="1 failed")):
            with pytest.raises(DirtyBaselineError):
                verify_green_baseline(tmp_path, test_command=["pytest", "-q"])
