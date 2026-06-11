"""Tests for the write_todos/read_todos planning tools (#70).

Catalog wiring lives in datum.agent_loop (TOOL_CATALOG) and gating in
datum.local_llm (READ_ONLY_TOOLS / WRITE_TOOLS / PATHLESS_WRITE_TOOLS).
Execution goes through the existing lane-tools sandbox: _execute_tool
spawns datum.lane_tools_runner, which runs scripts/lane-tools/*_todos.py.
Persistence target is .datum/todos.json under the episode's working repo
(cwd), format {"items": [{"task": str, "done": bool}]} per datum.todos.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from datum.agent_loop import TOOL_CATALOG, agent_loop
from datum.local_llm import (
    PATHLESS_WRITE_TOOLS,
    READ_ONLY_TOOLS,
    WRITE_TOOLS,
    _execute_tool,
)

# ── Test isolation: everything runs from tmp_path (issue #68 precedent) ─────


@pytest.fixture(autouse=True)
def _isolate_cwd(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)


# ── Helpers (mirrors tests/test_agent_loop.py loop-control helpers) ─────────


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


TOOL_CFG = {
    "allowed_tools": ["read_todos", "write_todos", "run_command"],
    "enable_write_tools": True,
    "allowed_write_dirs": [],
}

LOOP_CFG = {
    "think_model": "m-big",
    "decide_model": "m-fast",
    "max_steps": 5,
    "timeout_s": 60,
    "allowed_tools": ["read_todos", "write_todos", "run_command"],
    "enable_write_tools": True,
    "allowed_write_dirs": [],
}

ITEMS = [
    {"task": "write failing test", "done": True},
    {"task": "implement feature", "done": False},
]


# ── Catalog + gating ─────────────────────────────────────────────────────────


def test_catalog_contains_both_todo_tools():
    assert "read_todos" in TOOL_CATALOG
    assert "write_todos" in TOOL_CATALOG
    sig, desc = TOOL_CATALOG["write_todos"]
    assert "items" in sig
    assert desc  # prompt surface must explain when to use it


def test_read_todos_is_read_only():
    assert "read_todos" in READ_ONLY_TOOLS
    assert "read_todos" not in WRITE_TOOLS


def test_write_todos_is_write_gated_and_pathless():
    assert "write_todos" in WRITE_TOOLS
    assert "write_todos" in PATHLESS_WRITE_TOOLS
    assert "write_todos" not in READ_ONLY_TOOLS


def test_manifest_registers_both_tools():
    import tomllib

    from datum.lane_tools_runner import MANIFEST

    with MANIFEST.open("rb") as f:
        manifest = tomllib.load(f)
    assert "read_todos" in manifest["tools"]
    assert "write_todos" in manifest["tools"]


def test_write_todos_blocked_without_enable_write_tools():
    cfg = dict(TOOL_CFG, enable_write_tools=False)
    out, _ = _execute_tool(
        {"tool_name": "write_todos", "tool_args": {"items": ITEMS}}, cfg
    )
    assert "blocked" in out.lower()


# ── Execution through the lane-tools sandbox (real subprocess) ──────────────


def test_read_todos_missing_file_returns_empty_items(tmp_path):
    out, truncated = _execute_tool(
        {"tool_name": "read_todos", "tool_args": {}}, TOOL_CFG
    )
    assert truncated is False
    assert json.loads(out.strip()) == {"items": []}
    # read is read-only: must not create the file
    assert not (tmp_path / ".datum" / "todos.json").exists()


def test_write_then_read_round_trip(tmp_path):
    out, _ = _execute_tool(
        {"tool_name": "write_todos", "tool_args": {"items": ITEMS}}, TOOL_CFG
    )
    assert json.loads(out.strip()) == {"items": ITEMS}

    on_disk = json.loads(
        (tmp_path / ".datum" / "todos.json").read_text(encoding="utf-8")
    )
    assert on_disk == {"items": ITEMS}

    out, _ = _execute_tool({"tool_name": "read_todos", "tool_args": {}}, TOOL_CFG)
    assert json.loads(out.strip()) == {"items": ITEMS}


def test_write_todos_invalid_items_clean_error(tmp_path):
    bad = [{"task": "x", "done": "yes"}]  # done must be a bool
    out, _ = _execute_tool(
        {"tool_name": "write_todos", "tool_args": {"items": bad}}, TOOL_CFG
    )
    assert "error" in out.lower()
    assert "Traceback" not in out
    assert not (tmp_path / ".datum" / "todos.json").exists()


def test_write_todos_missing_items_clean_error():
    out, _ = _execute_tool({"tool_name": "write_todos", "tool_args": {}}, TOOL_CFG)
    assert "error" in out.lower()
    assert "items" in out
    assert "Traceback" not in out


def test_write_todos_non_list_items_clean_error():
    out, _ = _execute_tool(
        {"tool_name": "write_todos", "tool_args": {"items": 7}}, TOOL_CFG
    )
    assert "error" in out.lower()
    assert "Traceback" not in out


# ── Agent-loop wiring: pathless write must clear the path-centric guards ────


def test_agent_loop_write_todos_executes_without_path_arg():
    """write_todos carries no 'path' arg — the WRITE_TOOLS path-arg and
    read-before-write guards must not block it."""
    executed = []
    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["plan the work\nNEXT: write_todos", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_todos",
                        "tool_args": {"items": ITEMS},
                    },
                    {"action": "done", "summary": "planned"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: executed.append(tc)
            or (json.dumps({"items": ITEMS}, separators=(",", ":")), False),
        ),
    ):
        result = agent_loop("task", LOOP_CFG, phase="act_red")

    assert len(executed) == 1
    assert executed[0]["tool_name"] == "write_todos"
    obs = result["steps"][0]["observation"]
    assert "Error" not in obs
    assert '"items"' in obs
    assert result["escalated"] is False


def test_agent_loop_invalid_items_error_observation_loop_continues():
    """Validation failure becomes an observation; the loop keeps going and
    can still finish — no exception escapes."""
    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["track progress\nNEXT: write_todos", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_todos",
                        "tool_args": {"items": [{"task": "", "done": False}]},
                    },
                    {"action": "done", "summary": "recovered"},
                ]
            ),
        ),
        # real _execute_tool → real lane-tools subprocess → datum.todos
    ):
        result = agent_loop("task", LOOP_CFG, phase="act_red")

    assert result["escalated"] is False
    assert result["result"]["summary"] == "recovered"
    obs = result["steps"][0]["observation"]
    assert "error" in obs.lower()


def test_green_write_todos_does_not_arm_done_verification():
    """#67 guard: todo bookkeeping never mutates source, so a write_todos
    after the last passing test run must NOT cause done to be rejected.
    The fake output deliberately contains the '"ok": true' marker so only
    the PATHLESS_WRITE_TOOLS exemption can keep the guard disarmed."""
    steps = []
    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(
                ["run tests\nNEXT: run_command", "mark done\nNEXT: write_todos", "done"]
            ),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "run_command",
                        "tool_args": {"command": "pytest -q"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_todos",
                        "tool_args": {"items": [{"task": "ship it", "done": True}]},
                    },
                    {"action": "done", "summary": "verified"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                ("5 passed in 0.12s", False)
                if tc["tool_name"] == "run_command"
                else ('{"items":[{"task":"ship it","done":true}], "ok": true', False)
            ),
        ),
    ):
        result = agent_loop(
            "make tests pass", LOOP_CFG, phase="act_green", on_step=steps.append
        )

    assert all(s.get("tool_name") != "unverified_done" for s in steps)
    assert result["escalated"] is False
    assert result["result"]["summary"] == "verified"
