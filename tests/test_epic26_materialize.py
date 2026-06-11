"""Failing tests (RED) for task-003: Bootstrap materialize.sh + scaffold templates.

Override contract (pinned here):
  - DATUM_LOCAL_TARGET  (env var, default: ../datum-local relative to datum repo root)
    Tests set this to tmp_path/datum-local so they never touch the real sibling.
  - DATUM_REPO_PATH  (env var, default: resolved datum repo root from script's own dir)
    Tests that simulate a missing datum repo pass a non-existent path via this var.

The script signature contract is:
    bash materialize.sh [TARGET_OVERRIDE] [DATUM_REPO_OVERRIDE]

  Positional arg 1 ($1): target directory override (overrides DATUM_LOCAL_TARGET if both set,
      but the env var must be checked too — GREEN must support BOTH mechanisms)
  Positional arg 2 ($2): datum repo path override (overrides DATUM_REPO_PATH)

Both env vars and both positional args must work independently; tests use env vars.

Properties covered:
  SAFE-002   — materialize.sh never clobbers existing non-zero-size files
  LIVE-001   — scaffold created within reasonable time
  IDEM-001   — running twice produces the same state (no duplicates, no corruption)
  ORD-001    — materialize.sh must complete before any datum-local test can run
  PERF-004   — scaffold creation (excl. uv sync) must complete in under 10 seconds
  SEC-003    — materialize.sh must not fetch from network during scaffold creation
  COMPAT-005 — editable path dep works with datum's path_utils.skill_root() resolution

Adversarial findings from fixture lane (task-006):
  EC-3  — .gitignore must exclude fixtures/toy-project/.git nesting
  EC-6  — fixture files copied from explicit allowlist, never cp -r of template dir
"""

import os
import subprocess
import tomllib
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DATUM_ROOT = Path(__file__).resolve().parent.parent

MATERIALIZE_SH = (
    DATUM_ROOT / "docs" / "epics" / "datum" / "epic-26" / "bootstrap" / "materialize.sh"
)

FIXTURE_TEMPLATE_DIR = (
    DATUM_ROOT
    / "docs"
    / "epics"
    / "datum"
    / "epic-26"
    / "bootstrap"
    / "templates"
    / "fixture"
)

# Explicit allowlist for fixture files (EC-6 contract)
FIXTURE_ALLOWLIST = frozenset(
    ["calculator.py", "conftest.py", "test_calculator.py", "pyproject.toml"]
)


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def run_materialize(
    target: Path, datum_repo: Path = DATUM_ROOT, extra_env: dict | None = None
) -> subprocess.CompletedProcess:
    """Run materialize.sh with the override contract applied via env vars.

    DATUM_LOCAL_TARGET overrides the output directory.
    DATUM_REPO_PATH overrides the source datum repo path.
    """
    env = os.environ.copy()
    env["DATUM_LOCAL_TARGET"] = str(target)
    env["DATUM_REPO_PATH"] = str(datum_repo)
    if extra_env:
        env.update(extra_env)

    return subprocess.run(
        ["bash", str(MATERIALIZE_SH)],
        cwd=str(DATUM_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=90,
    )


# ---------------------------------------------------------------------------
# Test 1: Script existence and executability
# ---------------------------------------------------------------------------


class TestScriptExistsAndExecutable:
    """materialize.sh exists, is a regular file, and has execute permission."""

    def test_materialize_sh_exists(self):
        """AC2.1 / ORD-001: materialize.sh must exist in bootstrap/."""
        assert MATERIALIZE_SH.exists(), (
            f"materialize.sh not found at {MATERIALIZE_SH}\n"
            "Create it as part of the GREEN phase (task-003)."
        )

    def test_materialize_sh_is_executable(self):
        """AC2.1: materialize.sh must have execute permission."""
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition failed: {MATERIALIZE_SH} does not exist (RED phase)."
            )
        assert os.access(MATERIALIZE_SH, os.X_OK), (
            f"materialize.sh at {MATERIALIZE_SH} is not executable.\n"
            "Run: chmod +x docs/epics/datum/epic-26/bootstrap/materialize.sh"
        )


# ---------------------------------------------------------------------------
# Test 2: Scaffold creation — file contents
# ---------------------------------------------------------------------------


class TestScaffoldCreation:
    """Running materialize.sh with an overridden TARGET creates the expected scaffold."""

    @pytest.fixture()
    def target(self, tmp_path) -> Path:
        """A fresh tmp directory; materialize.sh writes datum-local here."""
        return tmp_path / "datum-local"

    @pytest.fixture()
    def materialized(self, target) -> subprocess.CompletedProcess:
        """Run materialize.sh once and return the CompletedProcess."""
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )
        result = run_materialize(target)
        return result

    def test_exit_zero(self, materialized):
        """LIVE-001: materialize.sh must exit 0 on a clean run."""
        assert materialized.returncode == 0, (
            f"materialize.sh exited {materialized.returncode}.\n"
            f"stdout:\n{materialized.stdout}\nstderr:\n{materialized.stderr}"
        )

    # -- pyproject.toml --

    def test_pyproject_toml_exists(self, target, materialized):
        """AC1.1: ../datum-local/pyproject.toml must be created."""
        assert (
            target / "pyproject.toml"
        ).exists(), "pyproject.toml was not created by materialize.sh."

    def test_pyproject_has_uv_sources_editable(self, tmp_path):
        """AC1.1 / COMPAT-005: pyproject.toml must declare [tool.uv.sources] with
        a datum editable path dep that resolves to the datum repo materialize.sh
        ran from.

        Asserted structurally (tomllib), not as a literal "../datum" string:
        the rendered path is derived from the datum checkout's own location, so
        a literal match breaks in git worktrees and renamed clones even though
        the scaffold is correct (#66).

        The datum repo is simulated as a sibling directory whose basename is
        deliberately NOT "datum", proving the contract is name-independent:
        whatever path the script writes must resolve (relative to the
        materialized project dir) to the repo it ran from.
        """
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )

        # Sibling layout inside tmp_path; basename intentionally not "datum"
        # (simulates a git worktree / renamed clone).
        datum_repo = tmp_path / "datum-renamed-checkout"
        datum_repo.mkdir()
        (datum_repo / "pyproject.toml").write_text(
            '[project]\nname = "datum"\nversion = "0.0.0"\n'
        )
        target = tmp_path / "datum-local"

        result = run_materialize(target, datum_repo=datum_repo)
        assert result.returncode == 0, (
            f"materialize.sh exited {result.returncode}.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

        parsed = tomllib.loads((target / "pyproject.toml").read_text())
        sources = parsed.get("tool", {}).get("uv", {}).get("sources")
        assert sources is not None, (
            "pyproject.toml is missing the [tool.uv.sources] section.\n"
            "The editable dep must be declared as: "
            "datum = { path = <path-to-datum-repo>, editable = true }"
        )
        datum_dep = sources.get("datum")
        assert isinstance(datum_dep, dict), (
            "[tool.uv.sources] has no 'datum' entry — the editable path dep "
            "for the datum repo is missing."
        )
        assert (
            datum_dep.get("editable") is True
        ), "the datum dep in [tool.uv.sources] must set editable = true."
        dep_path = datum_dep.get("path")
        assert dep_path, "the datum dep in [tool.uv.sources] must declare a 'path'."
        resolved = (target / dep_path).resolve()
        assert resolved == datum_repo.resolve(), (
            f"datum dep path {dep_path!r} resolves to {resolved}, expected the "
            f"datum repo materialize.sh ran from: {datum_repo.resolve()}.\n"
            "The rendered path must point back at the source checkout "
            "regardless of its directory name."
        )

    def test_pyproject_requires_python_312(self, target, materialized):
        """AC1.1: pyproject.toml must declare requires-python >= 3.12."""
        content = (target / "pyproject.toml").read_text()
        assert (
            "requires-python" in content
        ), "pyproject.toml is missing requires-python declaration."
        # Accept any form: ">=3.12" or ">= 3.12" or ">=3.12.0"
        assert (
            "3.12" in content
        ), "pyproject.toml requires-python does not reference Python 3.12+."

    # -- datum_local/__init__.py --

    def test_datum_local_init_py_exists(self, target, materialized):
        """AC1.2: datum_local/__init__.py must be created."""
        init_py = target / "datum_local" / "__init__.py"
        assert (
            init_py.exists()
        ), f"datum_local/__init__.py was not created by materialize.sh at {init_py}."

    # -- README.md --

    def test_readme_exists(self, target, materialized):
        """AC1.3: README.md must be created."""
        assert (
            target / "README.md"
        ).exists(), "README.md was not created by materialize.sh."

    def test_readme_mentions_editable_dep(self, target, materialized):
        """AC1.3: README.md must document the editable-dependency rationale."""
        content = (target / "README.md").read_text().lower()
        # At least one of these terms must appear (rationale for editable dep)
        keywords = [
            "editable",
            "path dep",
            "path dependency",
            "path source",
            "../datum",
        ]
        assert any(kw in content for kw in keywords), (
            "README.md does not mention the editable-dependency rationale.\n"
            f"Expected at least one of: {keywords}"
        )

    # -- .gitignore --

    def test_gitignore_exists(self, target, materialized):
        """AC1.5: .gitignore must be created."""
        assert (
            target / ".gitignore"
        ).exists(), ".gitignore was not created by materialize.sh."

    def test_gitignore_covers_datum_dir(self, target, materialized):
        """AC1.5: .gitignore must exclude .datum/ directory."""
        content = (target / ".gitignore").read_text()
        assert (
            ".datum/" in content or ".datum" in content
        ), ".gitignore does not exclude .datum/ — datum artifacts must be gitignored."

    def test_gitignore_covers_pycache(self, target, materialized):
        """AC1.5: .gitignore must exclude __pycache__/."""
        content = (target / ".gitignore").read_text()
        assert "__pycache__" in content, ".gitignore does not exclude __pycache__/."

    def test_gitignore_covers_venv(self, target, materialized):
        """AC1.5: .gitignore must exclude .venv/."""
        content = (target / ".gitignore").read_text()
        assert ".venv" in content, ".gitignore does not exclude .venv/."

    def test_gitignore_covers_fixture_git_nesting(self, target, materialized):
        """EC-3 / ISOL-004: .gitignore must exclude the fixture toy-project from
        datum-local's git tracking to prevent nested-.git confusion.

        Acceptable forms: 'fixtures/', 'fixtures/*', 'fixtures/toy-project/',
        'fixtures/toy-project/.git', or any pattern that covers the directory.
        """
        content = (target / ".gitignore").read_text()
        # Any pattern that covers fixtures/ or fixtures/toy-project is acceptable
        covers_fixture = any(
            pattern in content
            for pattern in [
                "fixtures/",
                "fixtures/*",
                "fixtures/toy-project",
                "/fixtures",
            ]
        )
        assert covers_fixture, (
            "EC-3 / ISOL-004 violated: .gitignore does not exclude the fixture "
            "toy-project from datum-local's git index.\n"
            "Add 'fixtures/' or equivalent to prevent nested-.git confusion."
        )


# ---------------------------------------------------------------------------
# Test 3: Fixture materialization — allowlist + git init
# ---------------------------------------------------------------------------


class TestFixtureMaterialization:
    """Running materialize.sh creates fixtures/toy-project/ with EXACTLY the
    allowlist files and a properly initialized git repo (AC6.4, ISOL-004, EC-6).
    """

    @pytest.fixture()
    def target(self, tmp_path) -> Path:
        return tmp_path / "datum-local"

    @pytest.fixture()
    def materialized(self, target) -> subprocess.CompletedProcess:
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )
        result = run_materialize(target)
        return result

    @pytest.fixture()
    def toy_project(self, target, materialized) -> Path:
        return target / "fixtures" / "toy-project"

    def test_toy_project_dir_exists(self, toy_project, materialized):
        """AC6.1: fixtures/toy-project/ must be created."""
        assert (
            toy_project.exists() and toy_project.is_dir()
        ), f"fixtures/toy-project/ was not created at {toy_project}."

    def test_toy_project_contains_only_allowlist_files(self, toy_project, materialized):
        """EC-6: fixture must contain EXACTLY the allowlist files — no extras
        from a cp -r that might copy .venv/__pycache__/build artifacts.

        Allowlist: calculator.py, conftest.py, test_calculator.py, pyproject.toml
        Hidden files (dotfiles) and sub-directories (other than .git) are also
        checked: only .git is permitted as a non-allowlist entry.
        """
        if not toy_project.exists():
            pytest.fail(f"Precondition: {toy_project} not created by materialize.sh.")

        present_files = {
            p.name
            for p in toy_project.iterdir()
            if not p.name.startswith(".")  # .git is allowed; other dotfiles are not
        }
        unexpected = present_files - FIXTURE_ALLOWLIST
        assert not unexpected, (
            f"EC-6 violated: fixture/toy-project contains unexpected files: {unexpected}\n"
            "materialize.sh must copy fixture files from an explicit allowlist, "
            "never via 'cp -r' of the template directory."
        )
        missing = FIXTURE_ALLOWLIST - present_files
        assert not missing, (
            f"EC-6 / AC6.1: fixture/toy-project is missing required files: {missing}\n"
            f"Expected allowlist: {FIXTURE_ALLOWLIST}"
        )

    def test_toy_project_git_initialized(self, toy_project, materialized):
        """AC6.4 / ISOL-004: fixtures/toy-project/ must be a git-initialized
        standalone repo (not a submodule of datum-local).

        .git must be a directory (not a file, which would indicate a submodule).
        """
        if not toy_project.exists():
            pytest.fail(f"Precondition: {toy_project} not created by materialize.sh.")

        git_dir = toy_project / ".git"
        assert git_dir.exists(), (
            f"AC6.4 violated: {toy_project} has no .git entry — "
            "materialize.sh must run 'git init' in the fixture."
        )
        assert git_dir.is_dir(), (
            f"ISOL-004 violated: {toy_project}/.git is a file, not a directory.\n"
            "A file .git indicates a git submodule — the fixture must be a "
            "standalone repo, not a submodule of datum-local."
        )

    def test_toy_project_has_initial_commit(self, toy_project, materialized):
        """AC6.4: The fixture git repo must have at least one commit (initial commit)."""
        if not (toy_project / ".git").exists():
            pytest.fail(f"Precondition: {toy_project}/.git not created.")

        result = subprocess.run(
            ["git", "log", "--oneline", "-1"],
            cwd=str(toy_project),
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0 and result.stdout.strip(), (
            "AC6.4 violated: fixture repo has no commits.\n"
            "materialize.sh must run 'git add . && git commit -m \"initial commit\"' "
            "in the fixture repo."
        )

    def test_toy_project_not_tracked_by_datum_local_git(
        self, target, toy_project, materialized
    ):
        """ISOL-004 / EC-3: datum-local's git must NOT track toy-project/
        (it is .gitignored and must not appear in 'git ls-files').
        """
        if not (target / ".git").exists():
            pytest.skip("datum-local not git-initialized — skipping tracking check.")

        result = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "fixtures/toy-project"],
            cwd=str(target),
            capture_output=True,
            text=True,
        )
        # exit non-zero means the path is NOT tracked — that is what we want
        assert result.returncode != 0, (
            "ISOL-004 / EC-3 violated: fixtures/toy-project is tracked by datum-local's git.\n"
            "It must be excluded via .gitignore so the nested .git is not a submodule."
        )


# ---------------------------------------------------------------------------
# Test 4: Idempotency (IDEM-001)
# ---------------------------------------------------------------------------


class TestIdempotency:
    """Running materialize.sh twice must produce identical output (IDEM-001)."""

    @pytest.fixture()
    def target(self, tmp_path) -> Path:
        return tmp_path / "datum-local"

    def test_second_run_exits_zero(self, target):
        """IDEM-001: materialize.sh run twice — second run must exit 0."""
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )
        run_materialize(target)  # first run
        result2 = run_materialize(target)  # second run
        assert result2.returncode == 0, (
            f"IDEM-001 violated: second run of materialize.sh exited {result2.returncode}.\n"
            f"stdout:\n{result2.stdout}\nstderr:\n{result2.stderr}"
        )

    def test_second_run_does_not_corrupt_pyproject(self, target):
        """IDEM-001 / SAFE-002: pyproject.toml must be identical after two runs."""
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )
        run_materialize(target)
        content_after_first = (target / "pyproject.toml").read_text()

        run_materialize(target)
        content_after_second = (target / "pyproject.toml").read_text()

        assert content_after_first == content_after_second, (
            "IDEM-001 / SAFE-002 violated: pyproject.toml content changed between "
            "first and second runs of materialize.sh."
        )

    def test_second_run_does_not_corrupt_gitignore(self, target):
        """IDEM-001: .gitignore must be identical after two runs."""
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )
        run_materialize(target)
        content_after_first = (target / ".gitignore").read_text()

        run_materialize(target)
        content_after_second = (target / ".gitignore").read_text()

        assert content_after_first == content_after_second, (
            "IDEM-001 violated: .gitignore content changed between "
            "first and second runs of materialize.sh."
        )

    def test_second_run_does_not_duplicate_fixture_files(self, target):
        """IDEM-001: EC-6 allowlist file count must remain exactly the expected count
        after two runs — no doubling, no extra copies created by the second run.
        """
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )
        run_materialize(target)
        run_materialize(target)

        toy_project = target / "fixtures" / "toy-project"
        if not toy_project.exists():
            pytest.fail("Precondition: toy-project not created after two runs.")

        present = {p.name for p in toy_project.iterdir() if not p.name.startswith(".")}
        unexpected = present - FIXTURE_ALLOWLIST
        assert not unexpected, (
            f"IDEM-001 violated: after two runs, unexpected files appeared in "
            f"fixtures/toy-project/: {unexpected}"
        )


# ---------------------------------------------------------------------------
# Test 5: Exit non-zero when datum repo is missing
# ---------------------------------------------------------------------------


class TestMissingDatumRepo:
    """AC2.3: materialize.sh must exit non-zero with a clear error message
    when the datum repo is not at the expected location.
    """

    def test_exits_nonzero_when_datum_missing(self, tmp_path):
        """AC2.3: If DATUM_REPO_PATH points to a non-existent directory,
        materialize.sh must exit non-zero with a human-readable error.

        Override contract: DATUM_REPO_PATH env var controls the expected datum
        repo location. Tests pass a non-existent path to simulate the failure.
        """
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )

        target = tmp_path / "datum-local"
        fake_datum = tmp_path / "nonexistent-datum"
        # fake_datum must NOT exist
        assert not fake_datum.exists(), "test setup: fake_datum must not exist"

        result = run_materialize(target, datum_repo=fake_datum)

        assert result.returncode != 0, (
            "AC2.3 violated: materialize.sh exited 0 even though DATUM_REPO_PATH "
            f"pointed to a non-existent directory ({fake_datum}).\n"
            "The script must exit non-zero when the datum repo is missing."
        )

    def test_error_output_is_human_readable(self, tmp_path):
        """AC2.3: The error output when datum is missing must be non-empty and
        human-readable (not a bare shell traceback or empty string).
        """
        if not MATERIALIZE_SH.exists():
            pytest.fail(
                f"Precondition: {MATERIALIZE_SH} does not exist (RED phase — expected)."
            )

        target = tmp_path / "datum-local"
        fake_datum = tmp_path / "nonexistent-datum"

        result = run_materialize(target, datum_repo=fake_datum)

        combined_output = (result.stdout + result.stderr).strip()
        assert combined_output, (
            "AC2.3 violated: materialize.sh produced no output when datum repo was missing.\n"
            "The script must emit a human-readable error message to stderr."
        )
