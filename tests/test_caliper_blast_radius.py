"""Tests for datum.caliper_blast_radius — write-time advisory (issue #83).

Tests: graph init, warning on findings, fail-open on exception,
no-caliper-installed path (mock import failure), integration with
agent_loop observation.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# ── Unit tests for caliper_blast_radius module ────────────────────────────────


def test_caliper_available_when_installed():
    """When caliper is importable, caliper_available() returns True."""
    # This test runs in the datum venv; caliper may or may not be installed.
    # We mock the module-level flag to test the function logic.
    import datum.caliper_blast_radius as mod
    from datum.caliper_blast_radius import caliper_available

    original = mod._CALIPER_AVAILABLE
    try:
        mod._CALIPER_AVAILABLE = True
        assert mod.caliper_available() is True
    finally:
        mod._CALIPER_AVAILABLE = original


def test_caliper_available_when_not_installed():
    """When caliper is NOT importable, caliper_available() returns False."""
    import datum.caliper_blast_radius as mod

    original = mod._CALIPER_AVAILABLE
    try:
        mod._CALIPER_AVAILABLE = False
        assert mod.caliper_available() is False
    finally:
        mod._CALIPER_AVAILABLE = original


def test_init_code_graph_returns_none_when_unavailable():
    """init_code_graph returns None when caliper is not installed."""
    import datum.caliper_blast_radius as mod

    original = mod._CALIPER_AVAILABLE
    try:
        mod._CALIPER_AVAILABLE = False
        assert mod.init_code_graph("/some/path") is None
    finally:
        mod._CALIPER_AVAILABLE = original


def test_init_code_graph_creates_db_and_indexes(tmp_path):
    """init_code_graph creates .datum/caliper-graph.sqlite and indexes files."""
    import datum.caliper_blast_radius as mod

    if not mod._CALIPER_AVAILABLE:
        pytest.skip("caliper not installed in datum venv")

    # Create a simple Python file
    (tmp_path / "hello.py").write_text("def greet():\n    return 'hi'\n")

    graph = mod.init_code_graph(tmp_path)
    assert graph is not None
    assert (tmp_path / ".datum" / "caliper-graph.sqlite").exists()

    stats = graph.stats()
    assert stats["symbols"] > 0


def test_init_code_graph_failopen_on_exception():
    """init_code_graph returns None on any internal exception."""
    import datum.caliper_blast_radius as mod

    if not mod._CALIPER_AVAILABLE:
        pytest.skip("caliper not installed in datum venv")

    original_cg = mod._CodeGraph
    try:
        mock_cg = MagicMock(side_effect=RuntimeError("boom"))
        mod._CodeGraph = mock_cg
        result = mod.init_code_graph("/nonexistent/path")
        assert result is None
    finally:
        mod._CodeGraph = original_cg


def test_check_written_file_returns_warnings_on_findings(tmp_path):
    """check_written_file returns WARNING strings when checks find issues."""
    import datum.caliper_blast_radius as mod

    # Create a mock graph that returns findings
    mock_graph = MagicMock()
    mock_graph.rebuild_incremental.return_value = 1
    mock_graph.run_checks.return_value = [
        {
            "check": "orphan_symbol",
            "severity": "info",
            "description": "Function with zero callers",
            "name": "dead_func",
            "file": "hello.py",
            "line": 5,
        }
    ]

    original_avail = mod._CALIPER_AVAILABLE
    original_cg = mod._CodeGraph
    try:
        mod._CALIPER_AVAILABLE = True
        mod._CodeGraph = MagicMock  # truthy

        # Create the file so path resolution works
        (tmp_path / "hello.py").write_text("def dead_func(): pass\n")

        warnings = mod.check_written_file(mock_graph, "hello.py", tmp_path)
        assert len(warnings) == 1
        assert "orphan_symbol" in warnings[0]
        assert "dead_func" in warnings[0]
        assert "[caliper blast-radius]" in warnings[0]
    finally:
        mod._CALIPER_AVAILABLE = original_avail
        mod._CodeGraph = original_cg


def test_check_written_file_returns_empty_when_no_findings(tmp_path):
    """check_written_file returns [] when no findings."""
    import datum.caliper_blast_radius as mod

    mock_graph = MagicMock()
    mock_graph.rebuild_incremental.return_value = 0
    mock_graph.run_checks.return_value = []

    original_avail = mod._CALIPER_AVAILABLE
    original_cg = mod._CodeGraph
    try:
        mod._CALIPER_AVAILABLE = True
        mod._CodeGraph = MagicMock

        (tmp_path / "clean.py").write_text("def clean(): pass\n")

        warnings = mod.check_written_file(mock_graph, "clean.py", tmp_path)
        assert warnings == []
    finally:
        mod._CALIPER_AVAILABLE = original_avail
        mod._CodeGraph = original_cg


def test_check_written_file_failopen_on_exception(tmp_path):
    """check_written_file returns [] on any internal exception."""
    import datum.caliper_blast_radius as mod

    mock_graph = MagicMock()
    mock_graph.rebuild_incremental.side_effect = RuntimeError("sqlite locked")

    original_avail = mod._CALIPER_AVAILABLE
    original_cg = mod._CodeGraph
    try:
        mod._CALIPER_AVAILABLE = True
        mod._CodeGraph = MagicMock

        (tmp_path / "broken.py").write_text("x = 1\n")

        warnings = mod.check_written_file(mock_graph, "broken.py", tmp_path)
        assert warnings == []
    finally:
        mod._CALIPER_AVAILABLE = original_avail
        mod._CodeGraph = original_cg


def test_check_written_file_noop_when_graph_none():
    """check_written_file returns [] when graph is None (caliper not installed)."""
    from datum.caliper_blast_radius import check_written_file

    assert check_written_file(None, "whatever.py", "/any") == []


# ── Integration test: agent_loop observation includes caliper warnings ────────


def _mk_think(texts):
    it = iter(texts)

    def fake(prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None):
        return {"text": next(it), "tokens": 10, "time_s": 0.1}

    return fake


def _mk_decide(decisions):
    it = iter(decisions)

    def fake(prompt, model_id, max_time_s=None):
        return {"data": next(it), "tokens": 5, "time_s": 0.05}

    return fake


BASE_CFG = {
    "think_model": "m-big",
    "decide_model": "m-fast",
    "max_steps": 5,
    "timeout_s": 60,
    "allowed_tools": ["read_file", "write_to_file", "run_command"],
    "enable_write_tools": True,
    "allowed_write_dirs": [],
}


def test_agent_loop_includes_caliper_warnings_in_observation(tmp_path, monkeypatch):
    """After a successful .py write, caliper blast-radius findings appear as
    WARNING lines in the observation — same style as _lint_python warnings."""
    monkeypatch.chdir(tmp_path)

    from datum.agent_loop import agent_loop

    mock_graph = MagicMock()
    mock_graph.rebuild_incremental.return_value = 1
    mock_graph.run_checks.return_value = [
        {
            "check": "high_fan_out",
            "severity": "medium",
            "description": "Function calls >8 other functions",
            "name": "god_function",
            "file": "new.py",
            "line": 1,
        }
    ]

    caliper_warnings = [
        "[caliper blast-radius] medium: high_fan_out (god_function) — Function calls >8 other functions"
    ]

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\ndef god_function(): pass\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "new.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool", lambda tc, cfg: ('{"ok": true}', False)
        ),
        patch("datum.agent_loop.init_code_graph", return_value=mock_graph),
        patch("datum.agent_loop.check_written_file", return_value=caliper_warnings),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    obs = result["steps"][0]["observation"]
    assert "[caliper blast-radius]" in obs
    assert "high_fan_out" in obs
    assert "WARNING" in obs


def test_agent_loop_no_caliper_warnings_when_unavailable(tmp_path, monkeypatch):
    """When caliper is not installed, no caliper warnings appear."""
    monkeypatch.chdir(tmp_path)

    from datum.agent_loop import agent_loop

    with (
        patch("datum.agent_loop._think", _mk_think(["write\n```\nx = 1\n```", "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "simple.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool", lambda tc, cfg: ('{"ok": true}', False)
        ),
        patch("datum.agent_loop.init_code_graph", return_value=None),
        patch("datum.agent_loop.check_written_file", return_value=[]),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    obs = result["steps"][0]["observation"]
    assert "[caliper blast-radius]" not in obs
