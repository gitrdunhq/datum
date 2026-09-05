# Skeleton: task-003 AC5 — PROP-005
# RED agent: fill in the assertion body. Do not rename this function or move this file.
# Traceability: AC5 → test_ac5_link_sub_issues_resolves_parent_and_child_node_ids_via_gh_is → tests/test_github_issues.py


class TestTask_003_AC5:
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
