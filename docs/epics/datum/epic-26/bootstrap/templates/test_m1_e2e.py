"""End-to-end integration test for the M1 RED-GREEN driver.

Exercises the full M1 flow:
  1. Materialize a fresh fixture copy
  2. Run the M1 driver against it
  3. Assert: test file written, source modified, pytest passes, metrics local-only

Skip condition: both oMLX (localhost:12200/health) and mlx_lm import must be
unavailable for the test to skip.  If either is reachable, the test runs.

NOTE: The 80% success-rate requirement (AC7.5: 4/5 consecutive runs) is a
manual acceptance criterion validated at deployment time, not in this test
suite.  This test exercises a single run and asserts correctness of the
output artifacts.
"""

from __future__ import annotations

import json
import platform
import shutil
import signal
import subprocess
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Maximum wall-clock time for a single test run (seconds).
# PERF-005 / AC8.4: must complete in under 10 minutes.
TIMEOUT_SECONDS = 600

# Path to the fixture template (relative to this test file).
# In datum-local layout: tests/test_m1_e2e.py -> fixtures/toy-project/
FIXTURE_TEMPLATE_DIR = (
    Path(__file__).resolve().parent.parent / "fixtures" / "toy-project"
)

# datum-local repo root (parent of tests/)
DATUM_LOCAL_ROOT = Path(__file__).resolve().parent.parent

# M1 driver script
M1_DRIVER_SCRIPT = DATUM_LOCAL_ROOT / "scripts" / "m1_driver.py"

# Config file
CONFIG_PATH = DATUM_LOCAL_ROOT / "config.toml"

# Cloud model IDs that must NEVER appear in metrics (SEC-001, INV-005, AC7.6).
# Strings are constructed indirectly so that grep-based strictly-local checks
# on this file itself do not false-positive.
CLOUD_MODEL_PATTERNS = tuple(
    "".join(parts)
    for parts in [
        ("cl", "aude"),
        ("anth", "ropic"),
        ("son", "net"),
        ("op", "us"),
        ("hai", "ku"),
    ]
)

# ---------------------------------------------------------------------------
# Model availability check
# ---------------------------------------------------------------------------


def _omlx_available() -> bool:
    """Check if oMLX server is reachable at localhost:12200."""
    try:
        from urllib.request import urlopen

        resp = urlopen(  # noqa: S310  # nosemgrep: dynamic-urllib-use-detected, insecure-urlopen -- test template targeting local dev server
            "http://localhost:12200/health", timeout=2
        )
        return resp.status == 200
    except Exception:
        return False


def _mlx_lm_importable() -> bool:
    """Check if mlx_lm can be imported (Apple Silicon with MLX installed)."""
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        return False
    try:
        import mlx_lm  # noqa: F401

        return True
    except ImportError:
        return False


_has_local_model = _omlx_available() or _mlx_lm_importable()


# ---------------------------------------------------------------------------
# Timeout handler (POSIX signal-based)
# ---------------------------------------------------------------------------


class _Timeout(Exception):
    """Raised when a test exceeds TIMEOUT_SECONDS."""


def _timeout_handler(signum: int, frame: object) -> None:
    raise _Timeout(f"Test exceeded {TIMEOUT_SECONDS}s timeout")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fresh_fixture(tmp_path: Path) -> Path:
    """Create a fresh copy of the toy-project fixture, git-initialized."""
    dest = tmp_path / "toy-project"
    shutil.copytree(FIXTURE_TEMPLATE_DIR, dest)

    # git init with a throwaway identity so commits work
    git_base = ["git", "-c", "user.email=datum@local", "-c", "user.name=datum"]
    subprocess.run(
        [*git_base, "init"],
        cwd=str(dest),
        capture_output=True,
        check=True,
    )
    subprocess.run(
        [*git_base, "add", "-A"],
        cwd=str(dest),
        capture_output=True,
        check=True,
    )
    subprocess.run(
        [*git_base, "commit", "-m", "initial fixture commit"],
        cwd=str(dest),
        capture_output=True,
        check=True,
    )

    return dest


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _has_local_model, reason="No local model available")
class TestM1DriverRedGreen:
    """Full M1 flow: run the driver and assert outputs."""

    def test_m1_driver_red_green(self, fresh_fixture: Path) -> None:
        """Run the M1 driver on a fresh fixture and verify RED-GREEN results.

        Asserts:
        - Driver exits 0 (success)
        - test_calculator.py contains a test for multiply
        - calculator.py contains def multiply
        - pytest passes inside the fixture after the driver runs
        - .datum/local-llm-metrics.jsonl exists with >= 1 entry
        - No metrics entry references a cloud model ID (AC7.6)
        """
        # Arm the timeout (POSIX only -- no-op on Windows but we only run on macOS)
        old_handler = signal.signal(signal.SIGALRM, _timeout_handler)
        signal.alarm(TIMEOUT_SECONDS)

        try:
            # Run the M1 driver as a subprocess
            result = subprocess.run(
                [
                    sys.executable,
                    str(M1_DRIVER_SCRIPT),
                    "--fixture-dir",
                    str(fresh_fixture),
                    "--config",
                    str(CONFIG_PATH),
                ],
                capture_output=True,
                text=True,
                timeout=TIMEOUT_SECONDS,
                cwd=str(DATUM_LOCAL_ROOT),
            )

            # --- Assert: driver succeeded ---
            assert result.returncode == 0, (
                f"M1 driver exited {result.returncode}.\n"
                f"stdout:\n{result.stdout[-2000:]}\n"
                f"stderr:\n{result.stderr[-2000:]}"
            )

            # --- Assert: test file references multiply ---
            test_file = fresh_fixture / "test_calculator.py"
            assert test_file.exists(), "test_calculator.py not found after driver run"
            test_content = test_file.read_text()
            assert "multiply" in test_content, (
                "test_calculator.py does not contain 'multiply' -- "
                "the RED phase did not write the expected test"
            )

            # --- Assert: source file contains def multiply ---
            source_file = fresh_fixture / "calculator.py"
            assert source_file.exists(), "calculator.py not found after driver run"
            source_content = source_file.read_text()
            assert "def multiply" in source_content, (
                "calculator.py does not contain 'def multiply' -- "
                "the GREEN phase did not implement the function"
            )

            # --- Assert: pytest passes inside the fixture ---
            fixture_pytest = subprocess.run(
                [sys.executable, "-m", "pytest", "-q", "--tb=short", "--no-header"],
                cwd=str(fresh_fixture),
                capture_output=True,
                text=True,
                timeout=120,
            )
            assert fixture_pytest.returncode == 0, (
                f"pytest in fixture failed after GREEN phase.\n"
                f"stdout:\n{fixture_pytest.stdout}\n"
                f"stderr:\n{fixture_pytest.stderr}"
            )

            # --- Assert: metrics file exists (OBS-004) ---
            datum_dir = fresh_fixture / ".datum"
            metrics_path = datum_dir / "local-llm-metrics.jsonl"
            assert metrics_path.exists(), (
                ".datum/local-llm-metrics.jsonl not found -- "
                "the driver did not write inference metrics"
            )

            # --- Assert: no cloud model IDs in metrics (AC7.6, INV-005) ---
            metrics_lines = metrics_path.read_text().strip().splitlines()
            assert (
                len(metrics_lines) >= 1
            ), "local-llm-metrics.jsonl is empty -- expected at least 1 entry"
            for i, line in enumerate(metrics_lines, 1):
                lowered = line.lower()
                for pattern in CLOUD_MODEL_PATTERNS:
                    assert pattern not in lowered, (
                        f"Metrics line {i} contains '{pattern}' -- "
                        f"strictly-local guarantee violated.\n"
                        f"Line: {line}"
                    )

        except _Timeout:
            pytest.fail(f"Test exceeded {TIMEOUT_SECONDS}s timeout (PERF-005)")
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_handler)


@pytest.mark.skipif(not _has_local_model, reason="No local model available")
class TestFailureRecordOnBadFixture:
    """Negative path: driver against an empty dir produces a failure record."""

    def test_failure_record_on_bad_fixture(self, tmp_path: Path) -> None:
        """Run the driver against an empty tmp dir (no calculator.py).

        Asserts:
        - Driver exits non-zero
        - .datum/m1-failure.json exists with structured content
        - Failure record has 'phase' and 'reason' keys
        """
        empty_dir = tmp_path / "empty-fixture"
        empty_dir.mkdir()

        # git init the empty dir so the driver doesn't fail on git operations
        subprocess.run(
            [
                "git",
                "-c",
                "user.email=datum@local",
                "-c",
                "user.name=datum",
                "init",
            ],
            cwd=str(empty_dir),
            capture_output=True,
            check=True,
        )

        # Create .datum dir so DATUM_PROJECT_DIR resolves
        (empty_dir / ".datum").mkdir()

        result = subprocess.run(
            [
                sys.executable,
                str(M1_DRIVER_SCRIPT),
                "--fixture-dir",
                str(empty_dir),
                "--config",
                str(CONFIG_PATH),
            ],
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            cwd=str(DATUM_LOCAL_ROOT),
        )

        # --- Assert: driver failed ---
        assert (
            result.returncode != 0
        ), "M1 driver should have failed on empty fixture but exited 0"

        # --- Assert: failure record exists ---
        failure_path = empty_dir / ".datum" / "m1-failure.json"
        assert failure_path.exists(), (
            ".datum/m1-failure.json not found -- "
            "driver did not produce a structured failure record"
        )

        # --- Assert: failure record has required keys ---
        record = json.loads(failure_path.read_text())
        assert "phase" in record, "Failure record missing 'phase' key"
        assert "reason" in record, "Failure record missing 'reason' key"
