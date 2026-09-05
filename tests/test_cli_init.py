"""Tests for `datum init` (datum/cli.py::init), the bootstrap every pipeline
run depends on. See AGENTS.md / docs for why this matters:

- `datum go` calls `datum init --json` at Act start (adopt-existing-branch
  path) and reads epicBranch/lanePlanPath/adopted from the JSON stdout
  (skills/src/datum-go.ts, shared/lane-steps.ts actStartSteps).
- `datum init --name <slug>` bootstraps a brand-new epic branch + TICKET.md.
- `datum init --refresh` re-materialises .datum/skills/*.js, .datum/hooks
  and .claude/agents from the installed datum package.

skills/src/datum-go.test.ts (AC1/AC2/AC4) already covers the adopt-path
JSON shape and the merge-conflict-refusal exit code by running the real
`datum` binary end-to-end; tests/test_pipeline_state.py already covers
reset_stale_pipeline_state() as a pure unit. This file covers what those
do not: the CliRunner-level branches of `init` itself (main branch
bootstrap, --name dedup, --refresh idempotency, non-git dir, dirty tree,
JSON stdout purity, and the stale-pipeline-state reset wired through
`init` end-to-end).
"""

import json
import subprocess
from pathlib import Path

import pytest
from typer.testing import CliRunner

from datum.cli import app

runner = CliRunner()


def _run_git(*args: str, cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )


@pytest.fixture
def git_repo(tmp_path, monkeypatch):
    """A real git repo with one commit on `main`, hooks disabled.

    core.hooksPath is pointed at /dev/null because a machine-global git
    hook would otherwise fire inside this throwaway repo and write into
    it (per-task requirement).
    """
    repo = tmp_path / "repo"
    repo.mkdir()
    _run_git("init", "-q", "-b", "main", cwd=repo)
    _run_git("config", "core.hooksPath", "/dev/null", cwd=repo)
    _run_git("config", "user.email", "test@example.com", cwd=repo)
    _run_git("config", "user.name", "Test", cwd=repo)
    (repo / "README.md").write_text("hello\n")
    _run_git("add", "README.md", cwd=repo)
    _run_git("commit", "-q", "-m", "initial commit", cwd=repo)

    # Prevent init()'s _install_workflows() from touching the real
    # developer home directory (~/.claude/workflows) during tests.
    fake_home = tmp_path / "fake_home"
    fake_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: fake_home)

    monkeypatch.chdir(repo)
    return repo


def _invoke(*args: str):
    return runner.invoke(app, ["init", *args])


# ---------------------------------------------------------------------------
# --json on main: adopted must be False (main is a PROTECTED_BRANCH), and
# stdout must be pure JSON (datum-go parses result.stdout as JSON).
# ---------------------------------------------------------------------------


def test_json_on_main_branch_reports_not_adopted(git_repo):
    result = _invoke("--json")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["adopted"] is False
    assert payload["epicBranch"] != "main"


def test_json_stdout_is_only_the_json_object(git_repo):
    """datum-go's Act-start step does `JSON.parse(result.stdout)` — any
    stray human-readable line breaks that parse."""
    result = _invoke("--json")
    assert result.exit_code == 0, result.output
    # The whole stdout must parse as JSON with nothing else present.
    payload = json.loads(result.stdout)
    assert isinstance(payload, dict)
    assert result.stdout.strip().count("\n") == 0


# ---------------------------------------------------------------------------
# Agent registration notice. Claude Code registers .claude/agents/*.md at
# session start (or on /reload-plugins), so agents `datum init` just wrote
# are unresolvable until then — a dogfooding run died with "agent type
# 'datum-cli' not found" right after a mid-session init. Say so, once,
# whenever agent files were actually (re)written.
# ---------------------------------------------------------------------------


def test_init_says_how_to_register_freshly_written_agents(git_repo):
    result = _invoke("--name", "first")
    assert result.exit_code == 0, result.output
    assert "/reload-plugins" in result.output
    assert "agent_types" in result.output  # names the fallback switch too


def test_init_stays_quiet_when_agents_are_already_current(git_repo):
    _invoke("--name", "first")
    _run_git("checkout", "-q", "main", cwd=git_repo)
    result = _invoke("--name", "second")
    assert result.exit_code == 0, result.output
    assert "/reload-plugins" not in result.output


def test_init_json_mode_never_prints_the_notice(git_repo):
    result = _invoke("--json")
    assert result.exit_code == 0, result.output
    assert "/reload-plugins" not in result.stdout


# ---------------------------------------------------------------------------
# --json on a feature branch with no epic artifacts: adoption path (#213).
# ---------------------------------------------------------------------------


def test_json_on_feature_branch_with_no_artifacts_is_adopted(git_repo):
    _run_git("checkout", "-b", "some-feature", cwd=git_repo)
    result = _invoke("--json")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["adopted"] is True
    assert payload["epicBranch"] == "some-feature"
    assert payload["lanePlanPath"] == str(Path(".datum") / "lane-plan.json")


def test_json_on_feature_branch_with_existing_ticket_is_not_adopted(git_repo):
    _run_git("checkout", "-b", "some-feature", cwd=git_repo)
    epic_dir = git_repo / "docs" / "epics" / "some-feature"
    epic_dir.mkdir(parents=True)
    (epic_dir / "TICKET.md").write_text("# Pre-existing ticket\n")

    result = _invoke("--json")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["adopted"] is False
    assert payload["epicBranch"] == "some-feature"
    # Pre-existing TICKET.md must be left untouched.
    assert (epic_dir / "TICKET.md").read_text() == "# Pre-existing ticket\n"


# ---------------------------------------------------------------------------
# --name on main: bootstraps a new datum/<slug> branch + TICKET.md.
# ---------------------------------------------------------------------------


def test_name_on_main_creates_slugified_branch_and_ticket(git_repo):
    result = _invoke("--name", "My Cool Epic", "--json")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["epicBranch"] == "datum/my-cool-epic"
    assert payload["adopted"] is False

    current = _run_git("branch", "--show-current", cwd=git_repo).stdout.strip()
    assert current == "datum/my-cool-epic"

    ticket = git_repo / "docs" / "epics" / "datum" / "my-cool-epic" / "TICKET.md"
    assert ticket.exists()
    assert "[Epic Title]" in ticket.read_text()


def test_name_reused_from_main_dedups_to_a_new_branch(git_repo):
    """Running --name with the same title twice must not silently reuse or
    error on the existing branch — ensure_feature_branch's make_unique
    dedup kicks in only when starting *from* a protected branch again."""
    first = _invoke("--name", "Dup Title", "--json")
    assert first.exit_code == 0, first.output
    assert json.loads(first.stdout)["epicBranch"] == "datum/dup-title"

    _run_git("checkout", "main", cwd=git_repo)
    second = _invoke("--name", "Dup Title", "--json")
    assert second.exit_code == 0, second.output
    second_branch = json.loads(second.stdout)["epicBranch"]
    assert second_branch != "datum/dup-title"
    assert second_branch.startswith("datum/dup-title")


# ---------------------------------------------------------------------------
# --refresh: re-materialise skills/agents/hooks, byte-identical, idempotent.
# ---------------------------------------------------------------------------


def test_refresh_copies_skills_byte_identical_to_package(git_repo):
    result = _invoke("--refresh")
    assert result.exit_code == 0, result.output

    package_skills = Path(__file__).resolve().parent.parent / "skills"
    local_skills = git_repo / ".datum" / "skills"
    assert local_skills.is_dir()

    src_files = sorted(package_skills.glob("datum-*.js"))
    assert src_files, "expected compiled skill .js files in the package skills dir"
    for src in src_files:
        dest = local_skills / src.name
        assert dest.is_file(), f"{dest} missing after --refresh"
        assert dest.read_bytes() == src.read_bytes()


def test_refresh_is_idempotent_on_second_run(git_repo):
    first = _invoke("--refresh")
    assert first.exit_code == 0, first.output
    local_skills = git_repo / ".datum" / "skills"
    before = {p.name: p.read_bytes() for p in local_skills.glob("*.js")}

    second = _invoke("--refresh")
    assert second.exit_code == 0, second.output
    after = {p.name: p.read_bytes() for p in local_skills.glob("*.js")}
    assert before == after


def test_refresh_json_stdout_is_only_the_json_object(git_repo):
    result = _invoke("--refresh", "--json")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert payload["refreshed"] is True
    assert result.stdout.strip().count("\n") == 0


# ---------------------------------------------------------------------------
# Stale pipeline-state reset, wired end-to-end through `init`.
# ---------------------------------------------------------------------------


def test_init_resets_stale_pipeline_state_from_a_different_branch(git_repo):
    datum_dir = git_repo / ".datum"
    datum_dir.mkdir(parents=True, exist_ok=True)
    (datum_dir / "pipeline-state.json").write_text(
        json.dumps(
            {
                "branch": "some-other-branch",
                "runId": "r1",
                "route": "full",
                "completedPhases": ["refine", "plan"],
                "currentPhase": "act",
            }
        )
    )

    _run_git("checkout", "-b", "some-feature", cwd=git_repo)
    result = _invoke("--json")
    assert result.exit_code == 0, result.output

    state = json.loads((datum_dir / "pipeline-state.json").read_text())
    assert state["branch"] == "some-feature"
    assert state["completedPhases"] == []


def test_init_does_not_reset_pipeline_state_for_the_same_branch(git_repo):
    _run_git("checkout", "-b", "some-feature", cwd=git_repo)
    datum_dir = git_repo / ".datum"
    datum_dir.mkdir(parents=True, exist_ok=True)
    (datum_dir / "pipeline-state.json").write_text(
        json.dumps(
            {
                "branch": "some-feature",
                "runId": "r1",
                "route": "full",
                "completedPhases": ["refine", "plan"],
                "currentPhase": "act",
            }
        )
    )

    result = _invoke("--json")
    assert result.exit_code == 0, result.output
    state = json.loads((datum_dir / "pipeline-state.json").read_text())
    assert state["completedPhases"] == ["refine", "plan"]


# ---------------------------------------------------------------------------
# Non-git dir and dirty working tree.
# ---------------------------------------------------------------------------


def test_init_outside_git_repo_fails_clearly(tmp_path, monkeypatch):
    non_git = tmp_path / "not_a_repo"
    non_git.mkdir()
    monkeypatch.chdir(non_git)
    result = _invoke("--json")
    assert result.exit_code != 0
    payload = json.loads(result.stdout)
    assert payload["error"] == "unsafe_branch_state"
    assert (
        "commit" in payload["message"].lower() or "repo" in payload["message"].lower()
    )


def test_init_with_dirty_working_tree_does_not_refuse(git_repo):
    """Only merge-conflict states are refused (_unsafe_branch_state_message);
    a plain dirty working tree (unstaged edit, no conflict markers) is not
    an unsafe state and init must proceed."""
    (git_repo / "README.md").write_text("dirty change, not committed\n")
    result = _invoke("--json")
    assert result.exit_code == 0, result.output
    payload = json.loads(result.stdout)
    assert "error" not in payload


def test_init_refuses_on_unresolved_merge_conflict(git_repo):
    _run_git("checkout", "-b", "branch-a", cwd=git_repo)
    (git_repo / "conflict.txt").write_text("branch-a version\n")
    _run_git("add", "conflict.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "add conflict.txt on branch-a", cwd=git_repo)

    _run_git("checkout", "main", cwd=git_repo)
    _run_git("checkout", "-b", "branch-b", cwd=git_repo)
    (git_repo / "conflict.txt").write_text("branch-b version\n")
    _run_git("add", "conflict.txt", cwd=git_repo)
    _run_git("commit", "-q", "-m", "add conflict.txt on branch-b", cwd=git_repo)

    subprocess.run(
        ["git", "merge", "branch-a"], cwd=git_repo, capture_output=True, text=True
    )

    result = _invoke("--json")
    assert result.exit_code != 0
    payload = json.loads(result.stdout)
    assert payload["error"] == "unsafe_branch_state"
    assert "conflict" in payload["message"].lower()


# ---------------------------------------------------------------------------
# Launch by scriptPath, never by name. `Workflow({name: "datum-go"})` resolves
# the ~/.claude/workflows registry copy, which the harness can cache for the
# session — a peer refreshed to a bundle with the lane-plan digest and still
# ran the old chunk relay (run wf_d95d30ed-366: the persisted script had 0
# digest refs while .datum/skills/datum-go.js had 9). Sub-workflows load via
# scriptPath from .datum/skills, which is why every sub-workflow fix took
# effect and every top-level datum-go fix silently did not. `datum init`
# prints the exact scriptPath launch line so the registry can never drift.
# ---------------------------------------------------------------------------


def test_init_prints_the_scriptpath_launch_line(git_repo):
    result = _invoke("--name", "first")
    assert result.exit_code == 0, result.output
    cfg = json.loads((git_repo / ".datum" / "config.json").read_text())
    expected = f'Workflow({{ scriptPath: "{cfg["skills_dir"]}/datum-go.js"'
    assert expected in result.output, result.output
    assert 'Workflow({ name: "datum-go"' not in result.output
    assert "configFingerprint" in result.output


def test_init_refresh_prints_the_scriptpath_launch_line(git_repo):
    _invoke("--name", "first")
    result = _invoke("--refresh")
    assert result.exit_code == 0, result.output
    cfg = json.loads((git_repo / ".datum" / "config.json").read_text())
    assert f'Workflow({{ scriptPath: "{cfg["skills_dir"]}/datum-go.js"' in result.output, result.output
