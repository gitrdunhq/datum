"""Tests for datum.wave_builder — BFS wave grouping."""

from datum.wave_builder import build_waves


def test_independent_tasks_single_wave():
    lanes = {
        "task-001": {"title": "A"},
        "task-002": {"title": "B"},
        "task-003": {"title": "C"},
    }
    waves = build_waves(lanes)
    assert len(waves) == 1
    assert set(waves[0]) == {"task-001", "task-002", "task-003"}


def test_linear_chain_three_waves():
    lanes = {
        "task-001": {"title": "A"},
        "task-002": {"title": "B", "depends_on": ["task-001"]},
        "task-003": {"title": "C", "depends_on": ["task-002"]},
    }
    waves = build_waves(lanes)
    assert len(waves) == 3
    assert waves[0] == ["task-001"]
    assert waves[1] == ["task-002"]
    assert waves[2] == ["task-003"]


def test_diamond_two_waves():
    lanes = {
        "task-001": {"title": "A"},
        "task-002": {"title": "B"},
        "task-003": {"title": "C", "depends_on": ["task-001", "task-002"]},
    }
    waves = build_waves(lanes)
    assert len(waves) == 2
    assert set(waves[0]) == {"task-001", "task-002"}
    assert waves[1] == ["task-003"]


def test_complex_dag():
    lanes = {
        "task-001": {"title": "A"},
        "task-002": {"title": "B", "depends_on": ["task-001"]},
        "task-003": {"title": "C"},
        "task-004": {"title": "D"},
        "task-005": {"title": "E", "depends_on": ["task-003", "task-004"]},
        "task-006": {"title": "F", "depends_on": ["task-002", "task-005"]},
    }
    waves = build_waves(lanes)
    # Wave 0: no deps. Wave 1: task-002 (dep: 001), task-005 (dep: 003+004).
    # Wave 2: task-006 (dep: 002+005).
    assert len(waves) == 3
    assert set(waves[0]) == {"task-001", "task-003", "task-004"}
    assert set(waves[1]) == {"task-002", "task-005"}
    assert waves[2] == ["task-006"]
