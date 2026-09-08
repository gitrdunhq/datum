"""Integration invariants covering task-001, task-008 (state-single-source-
of-truth epic).

This is a `kind: "integration"` lane (task-INT-6): its acceptance criteria
describe behaviour that task-001 (the decision doc,
docs/architecture/state-store.md) and task-008 (datum/memory/corpus_sql.py,
datum-tui/data.py) already merged. Per contract_summary in this lane's spec,
these tests are expected to PASS against the already-merged code — a failing
test here is a finding, not a placeholder to be filled in during GREEN.

INV-5: `corpus_sql.py`'s and `datum-tui/data.py`'s documented exceptions both
derive their justification from the same task-001 decision doc
(docs/architecture/state-store.md). Concretely: the decision doc names both
modules, verbatim, as its "Permanent documented exceptions (exactly two)";
`corpus_sql.py` cites the doc's path directly in its own in-code comment;
`datum-tui/data.py` cites the epic (#508) whose SPEC the decision doc says it
answers, so both modules trace back to the one document rather than each
inventing its own, independent justification.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DECISION_DOC = REPO_ROOT / "docs" / "architecture" / "state-store.md"
CORPUS_SQL = REPO_ROOT / "datum" / "memory" / "corpus_sql.py"
TUI_DATA = REPO_ROOT / "datum-tui" / "data.py"
LANE_PLAN = (
    REPO_ROOT
    / "docs"
    / "epics"
    / "datum"
    / "state-single-source-of-truth"
    / "lane-plan.json"
)


class TestInv5DecisionDocNamesBothExceptionsExactlyTwo:
    """The decision doc itself must enumerate exactly the two modules under
    test as its permanent documented exceptions."""

    def test_decision_doc_exists_and_declares_exactly_two_exceptions(self) -> None:
        assert DECISION_DOC.exists(), f"missing decision doc: {DECISION_DOC}"
        text = DECISION_DOC.read_text()
        assert "Permanent documented exceptions (exactly two)" in text

    def test_decision_doc_names_corpus_sql_as_exception_one(self) -> None:
        text = DECISION_DOC.read_text()
        section = text.split("Permanent documented exceptions (exactly two)")[1]
        assert "`datum/memory/corpus_sql.py`" in section
        assert "SQL-queryable access to state" in section

    def test_decision_doc_names_datum_tui_data_as_exception_two(self) -> None:
        text = DECISION_DOC.read_text()
        section = text.split("Permanent documented exceptions (exactly two)")[1]
        assert "`datum-tui/data.py`" in section
        assert "must not import the `datum` package" in section

    def test_decision_doc_is_task_001s_output_per_lane_plan(self) -> None:
        lane_plan = json.loads(LANE_PLAN.read_text())
        file_ownership = lane_plan["file_ownership"]
        assert file_ownership["docs/architecture/state-store.md"] == "task-001"


class TestInv5CorpusSqlCitesTheDecisionDocDirectly:
    """corpus_sql.py's own comment must point back at the exact decision doc
    path, not at some other/independent rationale."""

    def test_corpus_sql_comment_cites_the_decision_doc_path(self) -> None:
        src = CORPUS_SQL.read_text()
        assert "docs/architecture/state-store.md" in src

    def test_corpus_sql_comment_calls_out_one_of_two_documented_exceptions(
        self,
    ) -> None:
        src = CORPUS_SQL.read_text()
        assert "one of the two documented exceptions" in src


class TestInv5DatumTuiDataCitesTheSameEpicAsTheDecisionDoc:
    """datum-tui/data.py cites epic #508 by number; the decision doc must be
    the artifact of that very epic, so both modules resolve to one document."""

    def test_tui_data_comment_cites_epic_508(self) -> None:
        src = TUI_DATA.read_text()
        assert "#508" in src
        assert "one of the two" in src

    def test_lane_plan_github_issue_matches_the_epic_cited_by_tui_data(self) -> None:
        lane_plan = json.loads(LANE_PLAN.read_text())
        issue_numbers = {
            lane.get("github_issue")
            for lane in lane_plan["lanes"].values()
            if lane.get("github_issue") is not None
        }
        assert 508 in issue_numbers

    def test_decision_doc_header_names_the_same_epic_spec_path(self) -> None:
        text = DECISION_DOC.read_text()
        assert (
            "docs/epics/datum/state-single-source-of-truth/SPEC.md" in text
        ), "decision doc must cite the epic SPEC that #508 corresponds to"


class TestInv5NoIndependentJustificationDrift:
    """Negative path: neither module may carry a second, independent
    rationale comment that does not trace back to the shared decision doc —
    that would mean the two exceptions no longer share one source of truth."""

    def test_corpus_sql_does_not_invent_an_alternate_decision_reference(self) -> None:
        src = CORPUS_SQL.read_text()
        # No reference to a different/second architecture doc for this
        # exception; only the shared decision doc is cited.
        other_doc_refs = set(re.findall(r"docs/architecture/[\w.-]+\.md", src))
        assert other_doc_refs == {"docs/architecture/state-store.md"}

    def test_tui_data_module_still_imports_no_datum_package(self) -> None:
        src = TUI_DATA.read_text()
        assert "import datum" not in src
        assert "from datum" not in src


# ---------------------------------------------------------------------------
# II-002 (task-013): `datum lane-plan --validate` on a task-id collision
# exits 1 with the exact `{"valid": false, "reason": "task_id_collision",
# "collisions": [{"id", "epics"}]}` shape, and the halt message names both
# colliding epic paths plus the `--renumber` remedy, without ever
# auto-renumbering anything on its own.
# ---------------------------------------------------------------------------


def _ii002_hermetic_env(tmp_path: Path) -> dict:
    env = os.environ.copy()
    env["GIT_CONFIG_GLOBAL"] = str(tmp_path / "empty-gitconfig")
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_AUTHOR_NAME"] = "Datum Test"
    env["GIT_AUTHOR_EMAIL"] = "datum-test@example.com"
    env["GIT_COMMITTER_NAME"] = "Datum Test"
    env["GIT_COMMITTER_EMAIL"] = "datum-test@example.com"
    return env


def _ii002_git(args: list[str], cwd: Path, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=True
    )


def _ii002_init_repo(repo_root: Path, env: dict) -> Path:
    repo_root.mkdir(parents=True, exist_ok=True)
    _ii002_git(["init", "-q", "-b", "main"], repo_root, env)
    _ii002_git(["config", "core.hooksPath", "/dev/null"], repo_root, env)
    return repo_root


def _ii002_commit_file(
    repo_root: Path, rel_path: str, content: str, env: dict, message: str = "add file"
) -> None:
    path = repo_root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    _ii002_git(["add", rel_path], repo_root, env)
    _ii002_git(["commit", "-q", "-m", message], repo_root, env)


def _ii002_valid_task(task_id: str, files: list[str] | None = None) -> dict:
    return {
        "id": task_id,
        "title": f"Task {task_id}",
        "acceptance_criteria": ["does the thing"],
        "files": files or [f"src/{task_id.lower().replace('-', '_')}.py"],
        "red_note": "n/a",
        "depends_on": [],
    }


class TestII002ValidateCollisionExactPayloadShape:
    """`datum lane-plan --validate` on a collision must exit 1 with exactly
    `{"valid": false, "reason": "task_id_collision", "collisions":
    [{"id", "epics"}]}` — not some renamed/looser variant of that shape."""

    def test_validate_collision_exits_1_with_exact_payload_shape(
        self, tmp_path
    ) -> None:
        env = _ii002_hermetic_env(tmp_path)
        repo_root = _ii002_init_repo(tmp_path / "repo", env)
        _ii002_commit_file(
            repo_root,
            "docs/epics/epic-older/tasks.json",
            json.dumps([_ii002_valid_task("DAT-500", files=["src/older.py"])]),
            env,
        )
        _ii002_commit_file(
            repo_root,
            "docs/epics/epic-newer/tasks.json",
            json.dumps([_ii002_valid_task("DAT-500", files=["src/newer.py"])]),
            env,
        )

        result = subprocess.run(
            [
                "datum",
                "lane-plan",
                "--validate",
                "--input",
                "docs/epics/epic-newer/tasks.json",
            ],
            cwd=repo_root,
            env=env,
            capture_output=True,
            text=True,
        )

        assert result.returncode == 1, result.stdout
        payload = json.loads(result.stdout)
        assert payload["valid"] is False
        assert payload["reason"] == "task_id_collision"
        assert isinstance(payload["collisions"], list)
        assert len(payload["collisions"]) == 1
        record = payload["collisions"][0]
        assert record["id"] == "DAT-500"
        assert set(record["epics"]) == {"epic-older", "epic-newer"}

    def test_validate_collision_halt_message_names_both_epic_paths_and_renumber_remedy(
        self, tmp_path
    ) -> None:
        env = _ii002_hermetic_env(tmp_path)
        repo_root = _ii002_init_repo(tmp_path / "repo", env)
        _ii002_commit_file(
            repo_root,
            "docs/epics/epic-alpha/tasks.json",
            json.dumps([_ii002_valid_task("DAT-777", files=["src/alpha.py"])]),
            env,
        )
        _ii002_commit_file(
            repo_root,
            "docs/epics/epic-beta/tasks.json",
            json.dumps([_ii002_valid_task("DAT-777", files=["src/beta.py"])]),
            env,
        )

        result = subprocess.run(
            [
                "datum",
                "lane-plan",
                "--validate",
                "--input",
                "docs/epics/epic-beta/tasks.json",
            ],
            cwd=repo_root,
            env=env,
            capture_output=True,
            text=True,
        )

        assert result.returncode == 1, result.stdout
        payload = json.loads(result.stdout)
        remedy = payload["remedy"]
        assert "docs/epics/epic-alpha/tasks.json" in remedy
        assert "docs/epics/epic-beta/tasks.json" in remedy
        assert "--renumber" in remedy

    def test_validate_collision_never_auto_renumbers_the_input_file(
        self, tmp_path
    ) -> None:
        env = _ii002_hermetic_env(tmp_path)
        repo_root = _ii002_init_repo(tmp_path / "repo", env)
        _ii002_commit_file(
            repo_root,
            "docs/epics/epic-first/tasks.json",
            json.dumps([_ii002_valid_task("DAT-900", files=["src/first.py"])]),
            env,
        )
        newer_content = json.dumps(
            [_ii002_valid_task("DAT-900", files=["src/second.py"])]
        )
        _ii002_commit_file(
            repo_root,
            "docs/epics/epic-second/tasks.json",
            newer_content,
            env,
        )

        # `--validate` on a collision must never mutate the input file in
        # place: the halt names `--renumber` as the *remedy the operator
        # must run themselves*, it does not run it automatically.
        result = subprocess.run(
            [
                "datum",
                "lane-plan",
                "--validate",
                "--input",
                "docs/epics/epic-second/tasks.json",
            ],
            cwd=repo_root,
            env=env,
            capture_output=True,
            text=True,
        )

        assert result.returncode == 1, result.stdout
        payload = json.loads(result.stdout)
        assert payload["reason"] == "task_id_collision"
        on_disk = (repo_root / "docs/epics/epic-second/tasks.json").read_text()
        assert on_disk == newer_content
        assert "DAT-900" in on_disk
