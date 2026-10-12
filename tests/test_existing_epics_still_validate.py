"""Req 7 regression guard (task-014, AC1/AC2): every epic under docs/epics/
whose tasks.json already conformed to the id schema (^task-\\d+$ or
^task-INT-\\d+$) before the monotonic-task-ids change must still validate
cleanly with `datum lane-plan --validate`, and validation must never mutate
the input file on disk. Epics that predate the schema (bare slug ids) never
validated and must stay excluded rather than have the id pattern widened to
admit them.

Also guards that no committed tasks.json anywhere under docs/epics/ has
already been silently migrated to a <PREFIX>-\\d+ id (e.g. 'DAT-3') by an
earlier lane in this pipeline run.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
EPICS_ROOT = REPO_ROOT / "docs" / "epics"

_CONFORMING_ID = re.compile(r"^task-\d+$|^task-INT-\d+$")

# These predate the id schema entirely (bare feature-name slugs, not
# task-N/task-INT-N). They never validated against the schema and must be
# named here as explicitly skipped -- the id pattern is never widened to
# admit them.
PRE_SCHEMA_EPICS = {"bug-squash-round-2", "consumer-first-build-order"}


def _all_epic_tasks_files() -> list[Path]:
    return sorted(EPICS_ROOT.glob("*/*/tasks.json"))


def _first_committed_ids(tasks_path: Path, repo: Path | None = None) -> list[str] | None:
    """Task ids in the commit that first added tasks_path, or None when the
    file has no committed history (untracked, or git unavailable)."""
    import subprocess

    cwd = repo or tasks_path.parent
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()
        rel = str(tasks_path.resolve().relative_to(Path(top).resolve()))
        sha = subprocess.run(
            ["git", "log", "--diff-filter=A", "--format=%H", "--", rel],
            cwd=top, capture_output=True, text=True, check=True,
        ).stdout.split()
        if not sha:
            return None
        blob = subprocess.run(["git", "show", f"{sha[-1]}:{rel}"], cwd=top, capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError, ValueError):
        return None
    return [t.get("id", "") for t in _task_list(json.loads(blob))]


def _task_list(raw) -> list[dict]:
    if isinstance(raw, dict):
        return raw.get("tasks", [])
    return raw


def _conforms(tasks_path: Path) -> bool:
    raw = json.loads(tasks_path.read_text())
    tasks = _task_list(raw)
    ids = [t["id"] for t in tasks]
    return bool(ids) and all(_CONFORMING_ID.match(i) for i in ids)


class TestExistingEpicsStillValidate:
    def test_ac1_conforming_epics_validate_exit_0_with_bytes_unchanged(self, tmp_path):
        tasks_files = _all_epic_tasks_files()
        assert tasks_files, "expected at least one docs/epics/*/tasks.json on disk"

        conforming = [p for p in tasks_files if _conforms(p)]
        skipped = [p for p in tasks_files if not _conforms(p)]

        # The two pre-schema epics must show up as skipped-by-name, and
        # nothing else should be silently excluded.
        skipped_slugs = {p.parent.name for p in skipped}
        assert PRE_SCHEMA_EPICS <= skipped_slugs, (
            f"expected pre-schema epics {PRE_SCHEMA_EPICS} to be skipped, "
            f"got {skipped_slugs}"
        )
        assert len(conforming) >= 10, (
            "expected the bulk of docs/epics/ to already conform to the "
            f"task-N/task-INT-N id schema, got only {len(conforming)}"
        )

        for tasks_path in conforming:
            before_bytes = tasks_path.read_bytes()
            output_path = tmp_path / f"{tasks_path.parent.name}-lane-plan.json"
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "datum.cli",
                    "lane-plan",
                    "--validate",
                    "--input",
                    str(tasks_path),
                    "--output",
                    str(output_path),
                ],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, (
                f"{tasks_path} failed to validate: "
                f"stdout={result.stdout!r} stderr={result.stderr!r}"
            )
            after_bytes = tasks_path.read_bytes()
            assert (
                before_bytes == after_bytes
            ), f"{tasks_path} bytes changed after a --validate-only run"

    def test_ac1_pre_schema_epics_are_named_and_excluded_not_widened_in(self):
        """The two pre-schema epics are explicitly named as skipped; the
        conforming-id regex is never loosened to accept their bare slugs."""
        for slug in PRE_SCHEMA_EPICS:
            tasks_path = EPICS_ROOT / "datum" / slug / "tasks.json"
            assert tasks_path.exists(), f"expected fixture epic at {tasks_path}"
            assert not _conforms(tasks_path), (
                f"{slug} unexpectedly conforms to the task-N id schema; "
                "PRE_SCHEMA_EPICS must be updated, not the id pattern"
            )

    def test_ac2_no_committed_tasks_json_has_migrated_to_a_prefix_dash_number_id(self):
        # "Migrated" means an epic first committed with task-N ids that now
        # carries <PREFIX>-N ids. An epic born after monotonic ids shipped is
        # committed with <PREFIX>-N from its first commit (the first real one:
        # docs/epics/claude/datum-workflow-person-nmxqz4), and that is the
        # feature working, not a migration.
        prefix_id = re.compile(r"^[A-Z]{2,3}-\d+$")
        offenders = []
        for tasks_path in _all_epic_tasks_files():
            first = _first_committed_ids(tasks_path)
            if first is None or any(prefix_id.match(i) for i in first):
                continue
            raw = json.loads(tasks_path.read_text())
            for task in _task_list(raw):
                task_id = task.get("id", "")
                if prefix_id.match(task_id):
                    offenders.append((str(tasks_path), task_id))
        assert (
            offenders == []
        ), f"found migrated <PREFIX>-N ids in committed tasks.json files: {offenders}"

    def test_ac2_an_epic_born_with_task_ids_and_rewritten_to_prefix_ids_is_caught(self, tmp_path):
        # Catches: the born-with-prefix exemption also exempting a real
        # migration (first commit task-N, working copy DAT-N).
        import subprocess

        repo = tmp_path / "r"
        epic = repo / "docs" / "epics" / "x" / "e1"
        epic.mkdir(parents=True)
        run = lambda *a: subprocess.run(["git", *a], cwd=repo, check=True, capture_output=True)
        run("init", "-q", "-b", "main")
        run("config", "user.email", "t@example.com")
        run("config", "user.name", "T")
        run("config", "core.hooksPath", "/dev/null")
        (epic / "tasks.json").write_text(json.dumps([{"id": "task-001"}]))
        run("add", ".")
        run("commit", "-q", "-m", "init")
        (epic / "tasks.json").write_text(json.dumps([{"id": "DAT-1"}]))
        assert _first_committed_ids(epic / "tasks.json", repo=repo) == ["task-001"]
