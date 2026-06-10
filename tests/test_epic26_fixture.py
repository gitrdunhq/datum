"""Tests for epic-26 fixture repo template (task-006).

Properties covered:
  INV-002 — Fixture baseline pytest always green before M1 modifies any files
  BOUND-006 — Fixture source < 50 lines; fixture test < 20 lines
  ISOL-004 — Fixture .git is standalone, not a submodule of datum-local

RED phase: all tests must FAIL now because the templates do not yet exist.
"""

import subprocess
from pathlib import Path

import pytest

# Root of the datum repo (two levels up from this test file)
DATUM_ROOT = Path(__file__).resolve().parent.parent

FIXTURE_DIR = (
    DATUM_ROOT
    / "docs"
    / "epics"
    / "datum"
    / "epic-26"
    / "bootstrap"
    / "templates"
    / "fixture"
)

CALCULATOR_PY = FIXTURE_DIR / "calculator.py"
TEST_CALCULATOR_PY = FIXTURE_DIR / "test_calculator.py"
PYPROJECT_TOML = FIXTURE_DIR / "pyproject.toml"

# ---------------------------------------------------------------------------
# AC6.1 — three fixture template files exist
# ---------------------------------------------------------------------------


class TestFixtureFilesExistAC61:
    """AC6.1: docs/epics/datum/epic-26/bootstrap/templates/fixture/ contains the three required files."""

    def test_calculator_py_exists(self):
        """INV-002: calculator.py must exist in the fixture template dir."""
        assert CALCULATOR_PY.exists(), (
            f"Missing fixture template file: {CALCULATOR_PY}\n"
            "Create it as part of the GREEN phase (task-006)."
        )

    def test_test_calculator_py_exists(self):
        """INV-002: test_calculator.py must exist in the fixture template dir."""
        assert TEST_CALCULATOR_PY.exists(), (
            f"Missing fixture template file: {TEST_CALCULATOR_PY}\n"
            "Create it as part of the GREEN phase (task-006)."
        )

    def test_pyproject_toml_exists(self):
        """INV-002: pyproject.toml must exist in the fixture template dir."""
        assert PYPROJECT_TOML.exists(), (
            f"Missing fixture template file: {PYPROJECT_TOML}\n"
            "Create it as part of the GREEN phase (task-006)."
        )


# ---------------------------------------------------------------------------
# AC6.2 — calculator.py defines add but NOT multiply
# ---------------------------------------------------------------------------


class TestCalculatorSourceAC62:
    """AC6.2 + BOUND-006: calculator.py must define `add` and must NOT define `multiply`."""

    @pytest.fixture(autouse=True)
    def require_calculator_exists(self):
        """Skip with a clear failure message when the file doesn't exist yet."""
        if not CALCULATOR_PY.exists():
            pytest.fail(
                f"INV-002 / AC6.2 precondition: {CALCULATOR_PY} does not exist. "
                "Templates have not been created yet (RED phase)."
            )

    def test_add_function_defined(self):
        """INV-002: calculator.py must define an `add` function."""
        source = CALCULATOR_PY.read_text()
        assert "def add" in source, (
            "calculator.py does not define an `add` function. "
            "Add it as part of the GREEN phase."
        )

    def test_multiply_function_not_defined(self):
        """INV-002: calculator.py must NOT define a `multiply` function (intentional gap for M1)."""
        source = CALCULATOR_PY.read_text()
        assert "def multiply" not in source, (
            "calculator.py defines `multiply` — this function must be absent "
            "so the M1 driver has something to implement."
        )

    def test_source_under_50_lines(self):
        """BOUND-006: calculator.py must be < 50 lines."""
        lines = CALCULATOR_PY.read_text().splitlines()
        assert len(lines) < 50, (
            f"BOUND-006 violated: calculator.py is {len(lines)} lines "
            "(must be < 50)."
        )

    def test_test_file_under_20_lines(self):
        """BOUND-006: test_calculator.py must be < 20 lines."""
        lines = TEST_CALCULATOR_PY.read_text().splitlines()
        assert len(lines) < 20, (
            f"BOUND-006 violated: test_calculator.py is {len(lines)} lines "
            "(must be < 20)."
        )


# ---------------------------------------------------------------------------
# AC6.3 — baseline pytest run passes inside the fixture template dir
# ---------------------------------------------------------------------------


class TestFixtureBaselinePytestAC63:
    """AC6.3 + INV-002: `uv run pytest` in the fixture dir must exit 0."""

    def test_fixture_dir_exists_before_pytest(self):
        """INV-002 precondition: fixture directory must exist before we can run pytest."""
        assert FIXTURE_DIR.exists(), (
            f"INV-002 / AC6.3 precondition: fixture directory {FIXTURE_DIR} "
            "does not exist. Templates have not been created yet (RED phase)."
        )

    @pytest.mark.skipif(
        not FIXTURE_DIR.exists(),
        reason=f"Fixture dir {FIXTURE_DIR} not yet created (RED phase — expected failure).",
    )
    def test_baseline_pytest_passes(self):
        """INV-002: Running pytest in the fixture dir must exit 0 (baseline green).

        ISOL-004: The fixture is a standalone project; pytest is run in isolation
        from datum-local's venv.
        """
        result = subprocess.run(
            ["uv", "run", "pytest", "--tb=short", "-q"],
            cwd=FIXTURE_DIR,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, (
            f"INV-002 violated: baseline pytest in fixture dir exited {result.returncode}.\n"
            f"stdout:\n{result.stdout}\n"
            f"stderr:\n{result.stderr}"
        )


# ---------------------------------------------------------------------------
# ISOL-004 — fixture TEMPLATE must not contain .git (materialize.sh git-inits)
# ---------------------------------------------------------------------------


class TestFixtureGitIsolationISOL004:
    """ISOL-004: The fixture TEMPLATE must NOT contain a .git entry.

    Git cannot track a nested .git directory, so a template containing .git
    breaks on fresh clone. Git initialization of the materialized fixture is
    materialize.sh's job (task-003, AC6.4) — the standalone-repo check for the
    materialized fixture lives in the task-003 test suite.
    """

    def test_fixture_dir_exists_before_git_check(self):
        """ISOL-004 precondition: fixture template directory must exist."""
        assert FIXTURE_DIR.exists(), (
            f"ISOL-004 precondition: fixture directory {FIXTURE_DIR} "
            "does not exist. Templates have not been created yet (RED phase)."
        )

    @pytest.mark.skipif(
        not FIXTURE_DIR.exists(),
        reason=f"Fixture dir {FIXTURE_DIR} not yet created (RED phase — expected failure).",
    )
    def test_template_has_no_git_entry(self):
        """ISOL-004: the template dir must NOT contain .git (file or dir).

        Templates are materialized into standalone git repos later by
        materialize.sh (task-003); a .git entry inside the template itself
        cannot be tracked by the datum repo and would silently vanish on
        a fresh clone.
        """
        git_path = FIXTURE_DIR / ".git"
        assert not git_path.exists(), (
            f"ISOL-004 violated: {git_path} exists inside the fixture TEMPLATE. "
            "Remove it — git init of the materialized fixture belongs to "
            "materialize.sh (task-003), not the template."
        )
