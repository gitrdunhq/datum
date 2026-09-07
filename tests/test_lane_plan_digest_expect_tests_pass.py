"""task-001: `_LANE_FIELDS` and `build_digest`/`digest_plan_file` must carry
`expect_tests_pass` through a per-lane digest entry for integration lanes,
without disturbing the existing `depends_on` / `kind` passthrough, and
without turning into a blanket setdefault that invents the key for lanes
that never set it.

Per the lane spec's red_note: these tests must fail today because
`_LANE_FIELDS` lacks `'expect_tests_pass'` (AC1/AC2), and the absent/False
cases (AC3/AC4) pin that GREEN cannot just always add the key or always
truthify it.
"""

from __future__ import annotations

from datum.lane_plan_digest import _LANE_FIELDS, build_digest


def _integration_lane(**extra: object) -> dict:
    lane = {
        "title": "An integration lane",
        "files": ["src/a.py"],
        "reads": [],
        "kind": "integration",
        "expect_tests_pass": True,
        "depends_on": ["task-002", "task-003"],
    }
    lane.update(extra)
    return lane


def test_ac1_lane_fields_contains_expect_tests_pass_and_keeps_depends_on_and_kind():
    """AC1: 'expect_tests_pass' in _LANE_FIELDS is True, and 'depends_on'
    and 'kind' are still present — no reordering-driven removal."""
    assert "expect_tests_pass" in _LANE_FIELDS
    assert "depends_on" in _LANE_FIELDS
    assert "kind" in _LANE_FIELDS


def test_ac2_integration_lane_digest_entry_carries_flag_kind_and_depends_on():
    """AC2: a digest built from a plan whose lane dict is
    {'kind': 'integration', 'expect_tests_pass': True,
    'depends_on': ['task-002', 'task-003']} yields a per-lane digest entry
    with all three values carried through unchanged."""
    plan = {
        "lanes": {"task-001": _integration_lane()},
        "topological_order": ["task-001"],
        "total_lanes": 1,
    }
    digest = build_digest(plan, "deadbeef")
    entry = digest["lanes"]["task-001"]
    assert entry["expect_tests_pass"] is True
    assert entry["kind"] == "integration"
    assert entry["depends_on"] == ["task-002", "task-003"]


def test_ac3_behavioral_lane_without_expect_tests_pass_has_no_such_key():
    """AC3: a lane dict WITHOUT expect_tests_pass (a normal behavioral
    lane) produces a digest entry with no expect_tests_pass key at all —
    absent, not False."""
    lane = {
        "title": "A behavioral lane",
        "files": ["src/b.py"],
        "reads": [],
        "kind": "behavioral",
        "depends_on": [],
    }
    plan = {
        "lanes": {"task-002": lane},
        "topological_order": ["task-002"],
        "total_lanes": 1,
    }
    digest = build_digest(plan, "deadbeef")
    entry = digest["lanes"]["task-002"]
    assert "expect_tests_pass" not in entry


def test_ac4_expect_tests_pass_false_round_trips_as_false_not_dropped():
    """AC4: a lane dict with expect_tests_pass: False round-trips as
    entry['expect_tests_pass'] is False, not dropped by an
    `if lane[field]:` style check."""
    lane = _integration_lane(expect_tests_pass=False)
    plan = {
        "lanes": {"task-003": lane},
        "topological_order": ["task-003"],
        "total_lanes": 1,
    }
    digest = build_digest(plan, "deadbeef")
    entry = digest["lanes"]["task-003"]
    assert "expect_tests_pass" in entry
    assert entry["expect_tests_pass"] is False
