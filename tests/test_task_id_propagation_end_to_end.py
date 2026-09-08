"""task-014 AC3-AC6: a monotonic prefixed task id like 'DAT-142' must
propagate cleanly through every place a plain 'task-NNN' id used to go —
lane branch/worktree naming, the lane-state marker filename, the RED/GREEN/
REFACTOR commit subjects (and datum.render's commit-log regexes that parse
them back out), and the GitHub issue title.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from datum import github_issues as gi, render as dr
from datum.cli import (
    _resolve_lane_state_dir_or_exit,
    _resolve_lane_state_marker_path_or_exit,
)
from datum.worktree_manager import create_lane_worktree

LANE_ID = "DAT-142"


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True, check=True
    )


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    repo_root = tmp_path / "repo"
    repo_root.mkdir()
    _git(["init", "-q"], cwd=repo_root)
    _git(["config", "user.email", "test@example.com"], cwd=repo_root)
    _git(["config", "user.name", "Test"], cwd=repo_root)
    _git(["config", "core.hooksPath", "/dev/null"], cwd=repo_root)
    (repo_root / "README.md").write_text("hello\n")
    _git(["add", "README.md"], cwd=repo_root)
    _git(["commit", "-q", "-m", "initial commit"], cwd=repo_root)
    _git(["branch", "-M", "my-epic"], cwd=repo_root)
    return repo_root


class TestPrefixedIdPropagation:
    def test_ac3_lane_branch_and_worktree_path_contain_the_prefixed_id(
        self, repo: Path
    ):
        base_sha = _git(["rev-parse", "HEAD"], cwd=repo).stdout.strip()
        worktree_path = create_lane_worktree(
            "my-epic", LANE_ID, "run-1", base_sha, repo_root=repo
        )

        assert LANE_ID in worktree_path.parts

        branches = _git(["branch", "--list", f"my-epic--{LANE_ID}"], cwd=repo).stdout
        assert (
            f"my-epic--{LANE_ID}" in branches
        ), f"expected lane branch 'my-epic--{LANE_ID}', git branch --list gave: {branches!r}"

    def test_ac4_lane_state_marker_path_ends_in_prefixed_id_dot_json(
        self, tmp_path, monkeypatch
    ):
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".datum").mkdir()
        lane_dir = _resolve_lane_state_dir_or_exit("my-epic")
        marker_path = _resolve_lane_state_marker_path_or_exit(lane_dir, LANE_ID)

        assert marker_path.name == f"{LANE_ID}.json"
        assert str(marker_path).endswith(f"{LANE_ID}.json")

    def test_ac5_render_commit_regexes_extract_the_prefixed_id_from_red_and_green_subjects(
        self,
    ):
        """Commit subject construction lives only in TypeScript
        (skills/src/shared/commit-steps.ts / lane-steps.ts, e.g.
        `red(${taskId}): RED complete`). The Python-side contract this lane
        guards is datum.render's `_RED_COMMIT_RE` / `_GREEN_COMMIT_RE`
        correctly extracting a prefixed id like 'DAT-142' out of the
        literal subject line, exactly as red_note prescribes."""
        red_subject = f"red({LANE_ID}): RED complete"
        green_subject = f"green({LANE_ID}): GREEN complete"

        red_match = dr._RED_COMMIT_RE.search(red_subject)
        assert red_match is not None
        assert red_match.group(1) == LANE_ID

        green_match = dr._GREEN_COMMIT_RE.search(green_subject)
        assert green_match is not None
        assert green_match.group(1) == LANE_ID

        # A git-log line mixing both, as datum/closeout/collect_git.py
        # would collect it -- the derivation _git_derived_delivery() relies
        # on to build the Delivery section of RETRO.md.
        derived = dr._git_derived_delivery(
            {"commits": [f"aaaa111 {red_subject}", f"bbbb222 {green_subject}"]}
        )
        assert derived == {
            "completed": 1,
            "total": 1,
            "failed_terminal": 0,
            "say_do_ratio": 1.0,
        }

    def test_ac6_issue_title_built_for_the_prefixed_lane_id(
        self, tmp_path, monkeypatch
    ):
        captured_titles: list[str] = []

        def _fake_create_task(*, title, **kwargs):
            captured_titles.append(title)
            return (1, "node-1")

        monkeypatch.setattr(gi, "REPO", "gitrdunhq/datum")
        monkeypatch.setattr(gi, "create_labels", lambda: None)
        monkeypatch.setattr(gi, "create_epic", lambda *a, **k: (0, "epic-node"))
        monkeypatch.setattr(gi, "create_task", _fake_create_task)
        monkeypatch.setattr(gi, "link_sub_issue", lambda *a, **k: None)

        lane_plan_path = tmp_path / "lane-plan.json"
        lane_plan_path.write_text(
            json.dumps(
                {
                    "lanes": {
                        LANE_ID: {
                            "title": "Widen the thing",
                            "files": [],
                            "acceptance_criteria": [],
                            "depends_on": [],
                        }
                    },
                    "topological_order": [LANE_ID],
                    "total_lanes": 1,
                }
            )
        )

        gi.publish_lane_plan(str(lane_plan_path), "[epic] my-epic")

        assert captured_titles == ["[DAT-142] Widen the thing"]
