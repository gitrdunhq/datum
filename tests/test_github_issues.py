# Skeleton: task-003 AC5 — PROP-005
# RED agent: fill in the assertion body. Do not rename this function or move this file.
# Traceability: AC5 → test_ac5_link_sub_issues_resolves_parent_and_child_node_ids_via_gh_is → tests/test_github_issues.py

import pytest


class TestTask_003_AC5:
    @pytest.mark.xfail(
        reason="BUG: AC5 requires link_sub_issues(parent_number, child_numbers, repo) that resolves node IDs by number; only link_sub_issue(node_id, node_id) exists (datum/github_issues.py:265)"
    )
    def test_ac5_link_sub_issues_resolves_parent_and_child_node_ids_via_gh_is(self):
        """
        PROP-005: link_sub_issues resolves parent and child node IDs via gh issue view --json id -
        """
        # Arrange

        # Act

        # Assert — prove PROP-005
        raise AssertionError("RED agent: implement this assertion")


# ── Silent-fallback audit: parse_metadata malformed vs absent ──────────────

import json

import pytest

from datum.github_issues import list_sub_issues, parse_metadata


def test_parse_metadata_returns_none_when_no_metadata_block_present():
    assert parse_metadata("just a plain issue body, no metadata comment") is None


def test_parse_metadata_raises_on_malformed_json_instead_of_returning_none():
    """Regression guard: a present-but-malformed `datum:metadata` block (e.g.
    a hand-edited issue body with a JSON typo) must not be silently treated
    the same as "no metadata block at all" — list_sub_issues/
    build_lane_plan_from_epic do `meta or {}`, so a malformed block would
    silently produce an empty lane (no files/depends_on/acceptance_criteria)
    with no error, exactly like the dogfooding "empty intake treated as a
    fresh lane" bug."""
    body = '<!-- datum:metadata {"files": [oops-not-json]} -->'
    with pytest.raises(ValueError, match="metadata"):
        parse_metadata(body)


def test_list_sub_issues_surfaces_malformed_metadata_instead_of_silently_dropping_it(
    monkeypatch,
):
    monkeypatch.setattr(
        "datum.github_issues._gh_check",
        lambda *a, **k: json.dumps(
            [
                {
                    "number": 42,
                    "title": "broken metadata",
                    "state": "OPEN",
                    "body": '<!-- datum:metadata {"files": [oops]} -->',
                }
            ]
        ),
    )
    with pytest.raises(ValueError, match="metadata"):
        list_sub_issues(1)


# ---------------------------------------------------------------------------
# elonchesd dogfooding: the consumer repo had NO git remote, `gh repo view`
# failed, and _detect_repo() fell back to the hardcoded "gitrdunhq/datum" —
# the plan phase then filed 18 of another project's task issues (#396–#413)
# in datum's own tracker, plus triage's #414. Publishing must REFUSE when the
# target repo cannot be resolved, never default to someone else's tracker.
# ---------------------------------------------------------------------------

import subprocess as _sp

from datum import github_issues as gi


def _gh_repo_view_fails(*args, **kwargs):
    return _sp.CompletedProcess(args, 1, stdout="", stderr="no git remotes found")


def test_detect_repo_returns_none_when_gh_cannot_resolve_a_repo(monkeypatch):
    monkeypatch.setattr(gi.subprocess, "run", _gh_repo_view_fails)
    assert gi._detect_repo() is None


def test_detect_repo_never_hardcodes_a_fallback_repo():
    src = gi.__file__ and open(gi.__file__).read()
    assert 'return "gitrdunhq/datum"' not in src


def test_publish_lane_plan_skips_with_a_named_reason_when_repo_is_unresolved(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(gi, "REPO", None)

    def _must_not_be_called(*a, **k):
        raise AssertionError(f"gh must not be invoked without a resolved repo: {a}")

    monkeypatch.setattr(gi, "_gh", _must_not_be_called)
    monkeypatch.setattr(gi, "_gh_check", _must_not_be_called)
    lp = tmp_path / "lane-plan.json"
    lp.write_text(
        json.dumps(
            {
                "lanes": {
                    "task-001": {"title": "t", "files": [], "acceptance_criteria": []}
                },
                "topological_order": ["task-001"],
                "total_lanes": 1,
            }
        )
    )
    result = gi.publish_lane_plan(str(lp), "[epic] x")
    assert result["skipped"] == "github_repo_unresolved"
    # lane-plan.json must be left without github_issue fields
    plan = json.loads(lp.read_text())
    assert "github_issue" not in plan["lanes"]["task-001"]


def test_issue_operations_raise_a_named_error_when_repo_is_unresolved(monkeypatch):
    monkeypatch.setattr(gi, "REPO", None)
    with pytest.raises(gi.GitHubRepoUnresolvedError, match="github_repo_unresolved"):
        gi.fetch_issue(1)
    with pytest.raises(gi.GitHubRepoUnresolvedError, match="github_repo_unresolved"):
        gi.update_issue_stage(1, "done")


def test_issue_stage_cli_prints_json_error_exit_1_when_the_repo_is_unresolved(monkeypatch):
    """The tracker batch (skills/src/shared/tracker.ts stageFromSteps) reads
    this command's stdout as JSON; an uncaught GitHubRepoUnresolvedError was
    a traceback on stderr instead of a named error. Same contract as
    plan-issues: JSON with "error", exit 1, no traceback."""
    from typer.testing import CliRunner

    from datum import github_issues
    from datum.cli import app

    def _boom(*_a, **_k):
        raise github_issues.GitHubRepoUnresolvedError("no GitHub remote for this checkout")

    monkeypatch.setattr(github_issues, "update_issue_stage", _boom)
    res = CliRunner().invoke(app, ["issue-stage", "--issue", "7", "--stage", "red"])
    assert res.exit_code == 1
    assert "Traceback" not in res.output
    err = json.loads(res.output)
    assert err["ok"] is False
    assert err["issue"] == 7
    assert "no GitHub remote" in err["error"]
