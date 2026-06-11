"""Tests for datum.agent_loop — ReAct think/decide/execute/observe loop.

All model calls are mocked; these tests exercise loop control, fenced-block
extraction, history rendering, and termination conditions.
"""

from __future__ import annotations

from unittest.mock import patch


from datum.agent_loop import (
    _build_decide_prompt,
    _build_system_prompt,
    _build_think_prompt,
    _render_history,
    _strip_think_tags,
    _think,
    agent_loop,
    assemble_tool_args,
    extract_fenced_content,
)

# ── Fenced-block extraction ──────────────────────────────────────────────────


def test_extract_fenced_content_basic():
    thought = "I will write the file.\n```python\nx = 1\n```\nDone."
    assert extract_fenced_content(thought) == "x = 1\n"


def test_extract_fenced_content_takes_last_block():
    thought = "```python\nold = 1\n```\nActually:\n```python\nnew = 2\n```"
    assert extract_fenced_content(thought) == "new = 2\n"


def test_extract_fenced_content_no_block_returns_none():
    assert extract_fenced_content("no code here") is None


def test_extract_fenced_content_unlabeled_fence():
    thought = "```\nplain content\n```"
    assert extract_fenced_content(thought) == "plain content\n"


def test_extract_fenced_content_preserves_interior_blank_lines():
    thought = "```python\ndef f():\n    pass\n\n\ndef g():\n    pass\n```"
    assert (
        extract_fenced_content(thought)
        == "def f():\n    pass\n\n\ndef g():\n    pass\n"
    )


def test_extract_fenced_content_docstring_on_info_line():
    """Defect-1 regression: model places opening triple-quote on the fence's
    info-string line (```python \"\"\").  The captured content must include
    the triple-quote — dropping it makes the whole file an unterminated string."""
    thought = '```python """\nTest cases for strip_special_tokens function."""\n```'
    content = extract_fenced_content(thought)
    assert content is not None
    assert content.startswith('"""')


def test_extract_fenced_content_content_on_info_line():
    """Any non-info-string content on the opening fence line must survive."""
    thought = "```python x = 1\ny = 2\n```"
    content = extract_fenced_content(thought)
    assert content is not None
    assert "x = 1" in content


def test_extract_fenced_content_unbalanced_odd_fences():
    """Odd number of ``` markers — should still extract what it can."""
    thought = "```python\nfirst block\n```\nextra text\n```\n"
    content = extract_fenced_content(thought)
    # first block should be captured (the trailing ``` has no closer)
    assert content is not None
    assert "first block" in content


# ── Think-tag stripping (Qwen3 thinking mode) ────────────────────────────────


def test_strip_think_tags_removes_block():
    text = "<think>internal reasoning with ```code``` inside</think>The answer."
    assert _strip_think_tags(text) == "The answer."


def test_strip_think_tags_no_tags_passthrough():
    assert _strip_think_tags("plain text") == "plain text"


def test_strip_think_tags_multiline():
    text = "<think>\nline1\nline2\n</think>\nVisible."
    assert _strip_think_tags(text).strip() == "Visible."


def test_strip_think_tags_preserves_literals_in_file_content():
    """Only the LEADING reasoning block is stripped. <think> literals later in
    the response are content — e.g. a file that processes think tags. Stripping
    them corrupted the S0.1 sanitizer in transit and looped the GREEN phase."""
    thought = (
        "REASONING: add the tag patterns\n"
        "FILE:\n"
        '```python\ntags = [r"<think>", r"</think>"]\n```\n'
        'NEXT: write_to_file {"path": "datum/prompt_sanitizer.py"}'
    )
    assert _strip_think_tags(thought) == thought


def test_strip_think_tags_leading_block_then_literals_kept():
    text = '<think>real reasoning</think>keep r"<think>" this'
    assert _strip_think_tags(text) == 'keep r"<think>" this'


# ── Arg assembly (Python boundary for write content) ─────────────────────────


def test_assemble_tool_args_injects_fenced_content_for_write():
    decision = {"tool_name": "write_to_file", "tool_args": {"path": "a.py"}}
    thought = "Writing:\n```python\nx = 1\n```"
    args = assemble_tool_args(decision, thought)
    assert args == {"path": "a.py", "content": "x = 1\n"}


def test_assemble_tool_args_keeps_explicit_content():
    decision = {
        "tool_name": "write_to_file",
        "tool_args": {"path": "a.py", "content": "explicit"},
    }
    args = assemble_tool_args(decision, "```\nfenced\n```")
    assert args["content"] == "explicit"


def test_assemble_tool_args_read_tool_untouched():
    decision = {"tool_name": "read_file", "tool_args": {"path": "a.py"}}
    args = assemble_tool_args(decision, "```\nignored\n```")
    assert args == {"path": "a.py"}


def test_assemble_tool_args_write_without_content_or_fence():
    decision = {"tool_name": "write_to_file", "tool_args": {"path": "a.py"}}
    assert assemble_tool_args(decision, "no fence here") == {"path": "a.py"}


# ── Prompt builders ──────────────────────────────────────────────────────────


def test_think_prompt_contains_task():
    prompt = _build_think_prompt("add a test", [])
    assert "add a test" in prompt


def test_think_prompt_demands_fenced_content_for_writes():
    """Non-thinking instruct models state intent without emitting the file
    body — the per-step prompt must demand the fenced content explicitly
    (2507-DWQ live runs: write_to_file chosen, no fence in the thought)."""
    prompt = _build_think_prompt("implement multiply", [])
    assert "COMPLETE" in prompt
    assert "fenced code block" in prompt


def test_system_prompt_contains_tools_and_rules():
    system = _build_system_prompt(["read_file", "write_to_file"])
    assert "read_file" in system
    assert "write_to_file" in system
    assert "fenced code block" in system
    assert "comment or docstring" in system  # stale-comment rule


def test_system_prompt_mandatory_sections_not_terminal_line():
    """Instruct-2507 collapsed to emitting ONLY the 'end with NEXT:' line —
    the contract must be mandatory ordered sections, every section always
    required, never a conditional (research: format-collapse attractor)."""
    system = _build_system_prompt(["read_file", "write_to_file"])
    assert "REASONING:" in system
    assert "FILE:" in system
    assert "NEXT:" in system
    # sections are demanded in order, FILE has an explicit non-write value
    assert "NONE" in system
    # the old collapse-inducing phrasing is gone
    assert "End every response with exactly one line" not in system


def test_system_prompt_contains_full_response_exemplar():
    """One-shot exemplar showing all three sections locks the format for
    small instruct models (research fix #2)."""
    system = _build_system_prompt(["read_file", "write_to_file"])
    assert "EXAMPLE RESPONSE" in system
    # exemplar shows a real fenced file and a real NEXT line
    assert system.count("```") >= 2
    assert 'NEXT: write_to_file {"path"' in system


def test_think_passes_qwen_sampling_params():
    """Card-recommended sampling (top_p=0.8, top_k=20, presence_penalty)
    is never applied unless sent per-request — mlx-lm server defaults are
    top_p=1.0/top_k=off, which caused the 3x-pytest repetition loop."""
    captured = {}

    def fake_generate(prompt, model_id, **kwargs):
        captured.update(kwargs)
        return {"text": "ok", "tokens": 1}

    with patch("datum.agent_loop.generate", fake_generate):
        _think("p", "model", 2048, "sys")

    assert captured["temperature"] == 0.7
    sampling = captured["sampling"]
    assert sampling["top_p"] == 0.8
    assert sampling["top_k"] == 20
    assert sampling["presence_penalty"] == 1.0


def test_think_sampling_overridable_per_call():
    """THINK_SAMPLING is Qwen-2507 card tuning — a different model routed
    to the think tier must be able to carry its own sampling via config
    (model tiers and their params come from config, never hardcoded)."""
    captured = {}

    def fake_generate(prompt, model_id, **kwargs):
        captured.update(kwargs)
        return {"text": "ok", "tokens": 1}

    custom = {"top_p": 0.95, "top_k": 40}
    with patch("datum.agent_loop.generate", fake_generate):
        _think("p", "model", 2048, "sys", sampling=custom)

    assert captured["sampling"] == custom


def test_system_prompt_excludes_unlisted_tools():
    system = _build_system_prompt(["read_file"])
    assert "multi_replace_file_content" not in system


def test_decide_prompt_contains_thought_tail():
    prompt = _build_decide_prompt("thought text NEXT: read_file", ["read_file"])
    assert "NEXT: read_file" in prompt


def test_render_history_truncates_old_observations():
    history = [
        {
            "thought": "t1",
            "tool_name": "read_file",
            "tool_args": {"path": "a"},
            "observation": "x" * 5000,
        },
        {
            "thought": "t2",
            "tool_name": "run_command",
            "tool_args": {"command": "ls"},
            "observation": "recent output",
        },
    ]
    rendered = _render_history(history)
    assert "recent output" in rendered
    assert "x" * 5000 not in rendered  # old observation truncated


# ── Loop control (mocked models + tools) ─────────────────────────────────────


def _mk_think(texts):
    """Return a fake think() yielding canned thoughts in order."""
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


def test_agent_loop_done_immediately():
    with (
        patch("datum.agent_loop._think", _mk_think(["all good"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide([{"action": "done", "summary": "nothing to do"}]),
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")
    assert result["escalated"] is False
    assert result["result"]["summary"] == "nothing to do"
    assert result["steps_taken"] == 1


def test_agent_loop_tool_then_done():
    calls = []

    def fake_exec(tool_call, mt_config):
        calls.append(tool_call)
        return "file contents", False

    with (
        patch("datum.agent_loop._think", _mk_think(["read it", "done now"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "a.py"},
                    },
                    {"action": "done", "summary": "finished"},
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", fake_exec),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert result["escalated"] is False
    assert calls == [{"tool_name": "read_file", "tool_args": {"path": "a.py"}}]
    assert result["steps_taken"] == 2


def test_agent_loop_write_tool_gets_fenced_content():
    captured = {}

    def fake_exec(tool_call, mt_config):
        captured.update(tool_call)
        return '{"ok": true}', False

    thought = "Write the test.\n```python\nassert multiply(2, 3) == 6\n```"
    with (
        patch("datum.agent_loop._think", _mk_think([thought, "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "test_calculator.py"},
                    },
                    {"action": "done", "summary": "written"},
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", fake_exec),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert result["escalated"] is False
    assert captured["tool_args"]["content"] == "assert multiply(2, 3) == 6\n"


def test_agent_loop_max_steps_escalates():
    with (
        patch("datum.agent_loop._think", _mk_think(["go"] * 10)),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": f"f{i}.py"},
                    }
                    for i in range(10)
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", lambda tc, cfg: ("out", False)),
    ):
        cfg = dict(BASE_CFG, max_steps=3)
        result = agent_loop("task", cfg, phase="act_red")

    assert result["escalated"] is True
    assert result["reason"] == "max_steps_exhausted"
    assert result["steps_taken"] == 3


def test_agent_loop_repeated_identical_call_escalates():
    same = {"action": "tool", "tool_name": "read_file", "tool_args": {"path": "a.py"}}
    with (
        patch("datum.agent_loop._think", _mk_think(["go"] * 10)),
        patch("datum.agent_loop._decide", _mk_decide([same] * 10)),
        patch("datum.agent_loop._execute_tool", lambda tc, cfg: ("same out", False)),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert result["escalated"] is True
    assert result["reason"] == "loop_detected"


def test_write_echo_over_cap_carries_truncation_notice():
    """A successful write larger than the echo cap must tell the model the
    FULL file landed on disk — a silently cut-off echo makes literal models
    (2507) conclude the write failed and rewrite forever (S0.1 loop)."""
    long_content = "# pad line\n" * 600  # 6600 chars, valid Python, lint-clean
    steps = []

    with (
        patch("datum.agent_loop._think", _mk_think(["write it", "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "big.py", "content": long_content},
                    },
                    {"action": "done", "summary": "written"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                '{"path": "big.py", "bytes_written": 6600, "ok": true}',
                False,
            ),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    obs = steps[0]["observation"]
    assert "echo truncated" in obs
    assert f"{len(long_content)} chars" in obs
    assert "Do NOT rewrite" in obs


def test_write_echo_under_cap_has_no_truncation_notice():
    short_content = "x = 1\n"
    steps = []

    with (
        patch("datum.agent_loop._think", _mk_think(["write it", "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "small.py", "content": short_content},
                    },
                    {"action": "done", "summary": "written"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                '{"path": "small.py", "bytes_written": 6, "ok": true}',
                False,
            ),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    obs = steps[0]["observation"]
    assert "echo truncated" not in obs
    assert short_content in obs


def test_write_echo_realistic_test_file_is_echoed_complete():
    """A realistic generated-test-file (~2.5KB) must appear COMPLETE in the
    observation with no truncation notice. Live S0.2a runs proved a 2380-byte
    file over the old 1500-char cap made the model rewrite the file until
    loop detection fired, even though the file on disk was perfect."""
    medium_content = "# pad line\n" * 230  # 2530 chars, valid Python, lint-clean
    steps = []

    with (
        patch("datum.agent_loop._think", _mk_think(["write it", "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {
                            "path": "test_s02a.py",
                            "content": medium_content,
                        },
                    },
                    {"action": "done", "summary": "written"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                '{"path": "test_s02a.py", "bytes_written": 2530, "ok": true}',
                False,
            ),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    obs = steps[0]["observation"]
    assert medium_content in obs
    assert "echo truncated" not in obs


def test_agent_loop_write_tool_missing_content_feeds_error_back():
    """A write decision with no fenced block should not crash — the loop feeds
    an error observation back so the model can retry with a fenced block."""
    observations = []

    def fake_exec(tool_call, mt_config):
        observations.append(tool_call)
        return "ok", False

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["no fence", "with fence\n```\nc = 1\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "a.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "a.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", fake_exec),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    # First write had no content → not executed; second one was
    assert len(observations) == 1
    assert observations[0]["tool_args"]["content"] == "c = 1\n"
    assert result["escalated"] is False
    # The error must say the file was NOT touched — instruct models otherwise
    # declare DONE believing the write landed (2507-DWQ live runs).
    fence_error = result["steps"][0]["observation"]
    assert "NOT modified" in fence_error
    assert "DONE" in fence_error


def test_agent_loop_invalid_tool_name_feeds_error_back():
    with (
        patch("datum.agent_loop._think", _mk_think(["use bad tool", "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {"action": "tool", "tool_name": "rm_rf", "tool_args": {}},
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert result["escalated"] is False
    assert result["steps_taken"] == 2


def test_agent_loop_timeout_escalates():
    def slow_think(prompt, model_id, max_tokens, system=None):
        return {"text": "thinking", "tokens": 10, "time_s": 0.1}

    with (
        patch("datum.agent_loop._think", slow_think),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": f"{i}.py"},
                    }
                    for i in range(10)
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", lambda tc, cfg: ("out", False)),
        patch("datum.agent_loop.time") as mock_time,
    ):
        # monotonic: start=0, then each check is past the deadline
        mock_time.monotonic.side_effect = [0, 100, 100, 100, 100, 100]
        cfg = dict(BASE_CFG, timeout_s=50)
        result = agent_loop("task", cfg, phase="act_red")

    assert result["escalated"] is True
    assert result["reason"] == "timeout_exceeded"


# ── Read-before-write guard + write echo ─────────────────────────────────────


def test_agent_loop_blocks_overwrite_of_unread_existing_file(tmp_path, monkeypatch):
    """Structural guard: overwriting an existing file without reading it first
    is rejected with an error observation — no tool execution."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / "existing.py").write_text("original")
    executed = []

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\nnew stuff\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "existing.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: executed.append(tc) or ("ok", False),
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert executed == []  # write was blocked, not executed
    assert "read" in result["steps"][0]["observation"].lower()


def test_agent_loop_allows_write_after_read(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "existing.py").write_text("original")
    executed = []

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["read it", "write\n```\nnew\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "existing.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "existing.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: executed.append(tc) or ('{"ok": true}', False),
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert len(executed) == 2  # read then write both executed
    assert result["escalated"] is False


def test_agent_loop_allows_write_to_new_file(tmp_path, monkeypatch):
    """Creating a file that doesn't exist requires no prior read."""
    monkeypatch.chdir(tmp_path)
    executed = []

    with (
        patch("datum.agent_loop._think", _mk_think(["write\n```\nx\n```", "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "brand_new.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: executed.append(tc) or ('{"ok": true}', False),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red")

    assert len(executed) == 1


def test_agent_loop_write_observation_echoes_content(tmp_path, monkeypatch):
    """After a successful write the observation shows what's on disk, so the
    model does not rewrite blind."""
    monkeypatch.chdir(tmp_path)

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\nthe_payload = True\n```", "done"]),
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
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert "the_payload" in result["steps"][0]["observation"]


# ── Syntax lint gate on writes ───────────────────────────────────────────────


def test_agent_loop_write_with_syntax_error_rejects(tmp_path, monkeypatch):
    """Defect-2a: writing a .py file with a SyntaxError must REJECT the write
    (tool not executed, file not written) and return an error observation
    with the line number and error message so the model can fix it."""
    monkeypatch.chdir(tmp_path)
    executed = []

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\ndef broken(:\n    pass\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "bad.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: executed.append(tc) or ('{"ok": true}', False),
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    # Write must have been rejected — tool never executed
    assert executed == []
    obs = result["steps"][0]["observation"]
    assert "syntax" in obs.lower()
    assert "NOT written" in obs or "not written" in obs.lower()
    # Must tell the model the line number
    assert "line" in obs.lower()


def test_agent_loop_write_valid_python_no_warning(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\ndef fine():\n    pass\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "good.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool", lambda tc, cfg: ('{"ok": true}', False)
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert "syntax error" not in result["steps"][0]["observation"].lower()


def test_agent_loop_non_python_write_skips_lint(tmp_path, monkeypatch):
    """Non-.py files (e.g. markdown with unbalanced brackets) are not linted."""
    monkeypatch.chdir(tmp_path)

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\n# notes ((( [\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "notes.md"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool", lambda tc, cfg: ('{"ok": true}', False)
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert "syntax error" not in result["steps"][0]["observation"].lower()


# ── Lint gate: banned constructs, size, swallowed errors, /tmp ──────────────


def _write_and_run(thought_content, path="f.py"):
    """Run one write step with the given fenced content; return observation."""
    with (
        patch(
            "datum.agent_loop._think",
            _mk_think([f"write\n```\n{thought_content}\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": path},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool", lambda tc, cfg: ('{"ok": true}', False)
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")
    return result["steps"][0]["observation"]


def test_lint_flags_eval(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    obs = _write_and_run("x = eval(user_input)")
    assert "eval" in obs and "WARNING" in obs


def test_lint_flags_os_system(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    obs = _write_and_run("import os\nos.system('ls')")
    assert "os.system" in obs and "WARNING" in obs


def test_lint_flags_shell_true(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    obs = _write_and_run("import subprocess\nsubprocess.run('ls', shell=True)")
    assert "shell=True" in obs and "WARNING" in obs


def test_lint_flags_bare_except_pass(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    obs = _write_and_run("try:\n    f()\nexcept:\n    pass")
    assert "except" in obs and "WARNING" in obs


def test_lint_flags_tmp_path(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    obs = _write_and_run("OUT = '/tmp/results.json'")
    assert "/tmp" in obs and "WARNING" in obs


def test_lint_flags_oversized_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    big = "\n".join(f"x{i} = {i}" for i in range(501))
    obs = _write_and_run(big)
    assert "500" in obs and "WARNING" in obs


def test_lint_clean_code_no_warnings(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    obs = _write_and_run(
        "def safe(a):\n"
        "    try:\n"
        "        return a * 2\n"
        "    except ValueError as e:\n"
        "        raise RuntimeError('bad input') from e"
    )
    assert "WARNING" not in obs


# ── Project rules ingestion (AGENTS.md / CLAUDE.md) ──────────────────────────


def test_load_project_rules_prefers_agents_md(tmp_path):
    from datum.agent_loop import load_project_rules

    (tmp_path / "AGENTS.md").write_text("# Rules\n- always use uv\n- no /tmp\n")
    (tmp_path / "CLAUDE.md").write_text("- claude only rule\n")
    rules = load_project_rules(tmp_path)
    assert "always use uv" in rules
    assert "claude only rule" not in rules


def test_load_project_rules_falls_back_to_claude_md(tmp_path):
    from datum.agent_loop import load_project_rules

    (tmp_path / "CLAUDE.md").write_text("- run tests before commit\n")
    assert "run tests before commit" in load_project_rules(tmp_path)


def test_load_project_rules_missing_returns_empty(tmp_path):
    from datum.agent_loop import load_project_rules

    assert load_project_rules(tmp_path) == ""


def test_load_project_rules_caps_length(tmp_path):
    from datum.agent_loop import load_project_rules

    (tmp_path / "AGENTS.md").write_text(
        "\n".join(f"- rule {i} " + "x" * 80 for i in range(100))
    )
    assert len(load_project_rules(tmp_path)) <= 2000


def test_load_project_rules_ignores_digit_leading_prose(tmp_path):
    from datum.agent_loop import load_project_rules

    (tmp_path / "AGENTS.md").write_text(
        "3 devs maintain this repo\n"
        "2026 roadmap is ambitious\n"
        "64 GB machines are required\n"
        "- real bullet rule\n"
    )
    rules = load_project_rules(tmp_path)
    assert "3 devs maintain this repo" not in rules
    assert "2026 roadmap is ambitious" not in rules
    assert "64 GB machines are required" not in rules
    assert "real bullet rule" in rules


def test_load_project_rules_captures_numbered_list_items(tmp_path):
    from datum.agent_loop import load_project_rules

    (tmp_path / "AGENTS.md").write_text(
        "1. Always run tests\n" "2) Never push to main\n" "10. Keep diffs minimal\n"
    )
    rules = load_project_rules(tmp_path)
    assert "1. Always run tests" in rules
    assert "2) Never push to main" in rules
    assert "10. Keep diffs minimal" in rules


def test_system_prompt_includes_project_rules():
    system = _build_system_prompt(["read_file"], extra_rules="- project rule X")
    assert "project rule X" in system
    assert "PROJECT RULES" in system


def test_agent_loop_passes_extra_rules_to_system(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    captured = {}

    def spy_think(
        prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None
    ):
        captured["system"] = system
        return {"text": "all done", "tokens": 1, "time_s": 0}

    with (
        patch("datum.agent_loop._think", spy_think),
        patch(
            "datum.agent_loop._decide",
            _mk_decide([{"action": "done", "summary": "ok"}]),
        ),
    ):
        cfg = dict(BASE_CFG, extra_rules="- repo rule Z")
        agent_loop("task", cfg, phase="act_red")

    assert "repo rule Z" in captured["system"]


# ── Context monitor: checkpoint + compact at 80% ─────────────────────────────


def _fat_think(texts, prompt_tokens):
    it = iter(texts)

    def fake(prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None):
        return {
            "text": next(it),
            "tokens": 10,
            "time_s": 0.1,
            "prompt_tokens": prompt_tokens,
        }

    return fake


def test_agent_loop_checkpoints_at_context_threshold(tmp_path, monkeypatch):
    """At >=80% context use: checkpoint file written, history compacted."""
    import json as _json

    monkeypatch.chdir(tmp_path)

    with (
        patch(
            "datum.agent_loop._think",
            _fat_think(["read a", "read b", "done"], prompt_tokens=85_000),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "a.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "b.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", lambda tc, cfg: ("contents", False)),
    ):
        cfg = dict(BASE_CFG, context_window=100_000)
        result = agent_loop("task", cfg, phase="act_red")

    ckpt = tmp_path / ".datum" / "agent-checkpoint-act_red.json"
    assert ckpt.exists()
    data = _json.loads(ckpt.read_text())
    assert data["phase"] == "act_red"
    assert data["task"] == "task"
    assert isinstance(data["steps"], list)
    # full steps log is still returned despite compaction
    assert result["steps_taken"] == 3


def test_agent_loop_no_checkpoint_below_threshold(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    with (
        patch(
            "datum.agent_loop._think",
            _fat_think(["read", "done"], prompt_tokens=10_000),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "a.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", lambda tc, cfg: ("contents", False)),
    ):
        cfg = dict(BASE_CFG, context_window=100_000)
        agent_loop("task", cfg, phase="act_red")

    assert not (tmp_path / ".datum" / "agent-checkpoint-act_red.json").exists()


def test_compact_history_digests_steps():
    from datum.agent_loop import _compact_history

    history = [
        {
            "thought": "t",
            "tool_name": "read_file",
            "tool_args": {"path": "a.py"},
            "observation": "long file contents " * 50,
        },
        {
            "thought": "t",
            "tool_name": "run_command",
            "tool_args": {"command": "pytest"},
            "observation": "2 passed",
        },
    ]
    compacted = _compact_history(history)
    assert len(compacted) == 1
    digest = compacted[0]["observation"]
    assert "read_file" in digest
    assert "run_command" in digest
    assert len(digest) < 1000


# ── Adversarial review fixes ─────────────────────────────────────────────────


def test_agent_loop_model_exception_returns_structured_failure():
    """HIGH: a crashing model call must yield escalated=True, not a traceback."""

    def boom(prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None):
        raise OSError("oMLX connection refused")

    with patch("datum.agent_loop._think", boom):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert result["escalated"] is True
    assert "exception" in result["reason"]
    assert "oMLX connection refused" in result["reason"]


def test_agent_loop_decide_exception_returns_structured_failure():
    def boom(prompt, model_id, max_time_s=None):
        raise ValueError("Unterminated string starting at: line 1")

    with (
        patch("datum.agent_loop._think", _mk_think(["thinking"])),
        patch("datum.agent_loop._decide", boom),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    assert result["escalated"] is True
    assert "exception" in result["reason"]


def test_truncated_read_blocks_whole_file_write(tmp_path, monkeypatch):
    """HIGH: a truncated read must not license a whole-file overwrite."""
    monkeypatch.chdir(tmp_path)
    (tmp_path / "big.py").write_text("x = 1\n" * 2000)
    executed = []

    def exec_truncating_read(tool_call, mt_config):
        executed.append(tool_call)
        if tool_call["tool_name"] == "read_file":
            return "x = 1 ... [truncated]", True  # was_truncated=True
        return '{"ok": true}', False

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["read it", "rewrite\n```\nx = 2\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "big.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "big.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", exec_truncating_read),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    write_calls = [c for c in executed if c["tool_name"] == "write_to_file"]
    assert write_calls == []  # whole-file write blocked
    assert "replace_file_content" in result["steps"][1]["observation"]


def test_truncated_read_still_allows_surgical_replace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "big.py").write_text("x = 1\n" * 2000)
    executed = []

    def exec_truncating_read(tool_call, mt_config):
        executed.append(tool_call)
        if tool_call["tool_name"] == "read_file":
            return "x = 1 ... [truncated]", True
        return '{"ok": true}', False

    cfg = dict(
        BASE_CFG,
        allowed_tools=[
            "read_file",
            "write_to_file",
            "replace_file_content",
            "run_command",
        ],
    )
    with (
        patch("datum.agent_loop._think", _mk_think(["read", "replace", "done"])),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "big.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "replace_file_content",
                        "tool_args": {
                            "path": "big.py",
                            "old_text": "x = 1",
                            "new_text": "x = 2",
                        },
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", exec_truncating_read),
    ):
        agent_loop("task", cfg, phase="act_red")

    assert any(c["tool_name"] == "replace_file_content" for c in executed)


def test_unclosed_think_tag_stripped_and_turn_skipped():
    """MEDIUM: truncated <think> must not leak stale fenced blocks."""
    from datum.agent_loop import _strip_think_tags

    assert _strip_think_tags("<think>old file:\n```\nold = 1\n```") == ""
    # A mid-response <think> is content, not reasoning — only the leading
    # block is stripped (see test_strip_think_tags_preserves_literals_*).
    assert (
        _strip_think_tags("<think>a</think>keep<think>unclosed")
        == "keep<think>unclosed"
    )


def test_agent_loop_empty_thought_feeds_error_not_decide():
    decide_calls = []

    def spy_decide(prompt, model_id, max_time_s=None):
        decide_calls.append(prompt)
        return {"data": {"action": "done", "summary": "ok"}, "tokens": 1}

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["<think>ran out of tokens mid-reason", "DONE now"]),
        ),
        patch("datum.agent_loop._decide", spy_decide),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    # first turn produced no usable thought -> decide must not have seen it
    assert len(decide_calls) == 1
    assert result["escalated"] is False
    assert "cut off" in result["steps"][0]["observation"]


def test_write_tool_missing_path_gets_clear_error(tmp_path, monkeypatch):
    """LOW: missing path must not resolve to cwd and lie about read state."""
    monkeypatch.chdir(tmp_path)

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\nx\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {"action": "tool", "tool_name": "write_to_file", "tool_args": {}},
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool", lambda tc, cfg: ('{"ok": true}', False)
        ),
    ):
        result = agent_loop("task", BASE_CFG, phase="act_red")

    obs = result["steps"][0]["observation"]
    assert "path" in obs.lower()
    assert "exists but you have not read" not in obs


# ── Budget-capped model calls (#61) ──────────────────────────────────────────
# The wall-clock deadline was only checked between steps: a single THINK call
# could hang for the full HTTP request timeout (request_timeout_s, default
# 300s) past the loop budget. Each model call now carries max_time_s capped
# at the remaining budget, and a call is never issued below a sane floor.


def test_think_max_time_is_remaining_budget_plus_slack():
    """THINK and DECIDE receive max_time_s = remaining loop budget + slack,
    shrinking as wall-clock time drains."""
    import pytest

    from datum.agent_loop import BUDGET_SLACK_S

    captured = {}

    def spy_think(
        prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None
    ):
        captured["think_max_time_s"] = max_time_s
        return {"text": "all done", "tokens": 1}

    def spy_decide(prompt, model_id, max_time_s=None):
        captured["decide_max_time_s"] = max_time_s
        return {"data": {"action": "done", "summary": "ok"}, "tokens": 1}

    with (
        patch("datum.agent_loop._think", spy_think),
        patch("datum.agent_loop._decide", spy_decide),
        patch("datum.agent_loop.time") as mock_time,
    ):
        # start=0; remaining check at t=10 → 50 left; decide at t=30 → 30 left
        mock_time.monotonic.side_effect = [0.0, 10.0, 30.0, 40.0]
        cfg = dict(BASE_CFG, timeout_s=60)
        result = agent_loop("task", cfg, phase="act_red")

    assert result["escalated"] is False
    assert captured["think_max_time_s"] == pytest.approx(50.0 + BUDGET_SLACK_S)
    assert captured["decide_max_time_s"] == pytest.approx(30.0 + BUDGET_SLACK_S)


def test_think_not_called_when_budget_below_floor_midrun():
    """When the remaining budget drops below the floor mid-run, the loop
    escalates with the existing timeout reason instead of issuing a THINK
    that could overrun by up to the HTTP timeout."""
    think_calls = []

    def spy_think(
        prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None
    ):
        think_calls.append(max_time_s)
        return {"text": "go", "tokens": 1}

    with (
        patch("datum.agent_loop._think", spy_think),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "a.py"},
                    }
                ]
            ),
        ),
        patch("datum.agent_loop._execute_tool", lambda tc, cfg: ("out", False)),
        patch("datum.agent_loop.time") as mock_time,
    ):
        # iter1 at t=1 (59 left, call issued); iter2 at t=57 (3 left < floor)
        mock_time.monotonic.side_effect = [0.0, 1.0, 2.0, 57.0, 58.0]
        cfg = dict(BASE_CFG, timeout_s=60)
        result = agent_loop("task", cfg, phase="act_red")

    assert len(think_calls) == 1
    assert result["escalated"] is True
    assert result["reason"] == "timeout_exceeded"
    assert result["steps_taken"] == 1


def test_budget_exhausted_before_first_think_makes_no_call():
    """Negative path: budget already exhausted → no model call at all,
    escalates with the existing timeout reason."""
    think_calls = []
    decide_calls = []

    def spy_think(
        prompt, model_id, max_tokens, system=None, sampling=None, max_time_s=None
    ):
        think_calls.append(max_time_s)
        return {"text": "go", "tokens": 1}

    def spy_decide(prompt, model_id, max_time_s=None):
        decide_calls.append(max_time_s)
        return {"data": {"action": "done", "summary": "ok"}, "tokens": 1}

    with (
        patch("datum.agent_loop._think", spy_think),
        patch("datum.agent_loop._decide", spy_decide),
        patch("datum.agent_loop.time") as mock_time,
    ):
        mock_time.monotonic.side_effect = [0.0, 100.0, 100.0]
        cfg = dict(BASE_CFG, timeout_s=50)
        result = agent_loop("task", cfg, phase="act_red")

    assert think_calls == []
    assert decide_calls == []
    assert result["escalated"] is True
    assert result["reason"] == "timeout_exceeded"
    assert result["steps_taken"] == 0


def test_think_threads_max_time_s_to_generate():
    """_think forwards max_time_s to generate (same threading as sampling)."""
    captured = {}

    def fake_generate(prompt, model_id, **kwargs):
        captured.update(kwargs)
        return {"text": "ok", "tokens": 1}

    with patch("datum.agent_loop.generate", fake_generate):
        _think("p", "model", 2048, "sys", max_time_s=37.5)

    assert captured["max_time_s"] == 37.5


def test_decide_threads_max_time_s_to_structured():
    """_decide forwards max_time_s to structured."""
    from datum.agent_loop import _decide

    captured = {}

    def fake_structured(prompt, schema, model_id, **kwargs):
        captured.update(kwargs)
        return {"data": {"action": "done", "summary": "ok"}, "tokens": 1}

    with patch("datum.agent_loop.structured", fake_structured):
        _decide("p", "model", max_time_s=12.5)

    assert captured["max_time_s"] == 12.5


# ── Overwrite-loss warning (Defect-3: clobbered test file) ──────────────────


def test_overwrite_removing_defs_warns(tmp_path, monkeypatch):
    """When write_to_file overwrites a .py file and removes top-level
    definitions, the observation must include a WARNING naming what was lost."""
    monkeypatch.chdir(tmp_path)
    existing = tmp_path / "test_thing.py"
    existing.write_text(
        "def test_a():\n    pass\n\n"
        "def test_b():\n    pass\n\n"
        "def test_c():\n    pass\n"
    )

    # New content only has test_c — a and b removed
    new_content = "def test_c():\n    pass\n"
    steps = []

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["read", "write\n```\n" + new_content + "\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "test_thing.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "test_thing.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                (
                    existing.read_text(),
                    False,
                )
                if tc["tool_name"] == "read_file"
                else ('{"path": "test_thing.py", "ok": true}', False)
            ),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    # The write step's observation must warn about the removed definitions
    write_obs = steps[1]["observation"]
    assert "WARNING" in write_obs
    assert "REMOVED" in write_obs
    assert "test_a" in write_obs
    assert "test_b" in write_obs


def test_overwrite_keeping_all_defs_no_warning(tmp_path, monkeypatch):
    """When an overwrite preserves all definitions, no removal warning."""
    monkeypatch.chdir(tmp_path)
    existing = tmp_path / "calc.py"
    existing.write_text("def add(a, b):\n    return a + b\n")

    new_content = (
        "def add(a, b):\n    return a + b\n\ndef mul(a, b):\n    return a * b\n"
    )
    steps = []

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["read", "write\n```\n" + new_content + "\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "calc.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "calc.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                (
                    existing.read_text(),
                    False,
                )
                if tc["tool_name"] == "read_file"
                else ('{"path": "calc.py", "ok": true}', False)
            ),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    write_obs = steps[1]["observation"]
    assert "REMOVED" not in write_obs


def test_overwrite_unparseable_old_skips_comparison(tmp_path, monkeypatch):
    """If the old file doesn't parse, the comparison is skipped (no crash)."""
    monkeypatch.chdir(tmp_path)
    existing = tmp_path / "broken.py"
    existing.write_text("def broken(:\n    pass\n")

    new_content = "def fixed():\n    pass\n"
    steps = []

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["read", "write\n```\n" + new_content + "\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "broken.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "broken.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                (
                    existing.read_text(),
                    False,
                )
                if tc["tool_name"] == "read_file"
                else ('{"path": "broken.py", "ok": true}', False)
            ),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    # No crash, no REMOVED warning
    write_obs = steps[1]["observation"]
    assert "REMOVED" not in write_obs


def test_overwrite_loss_warning_truncates_long_name_list(tmp_path, monkeypatch):
    """When more than 10 defs are removed, the name list is truncated."""
    monkeypatch.chdir(tmp_path)
    existing = tmp_path / "big.py"
    defs = "\n".join(f"def func_{i}():\n    pass\n" for i in range(15))
    existing.write_text(defs)

    new_content = "x = 1\n"
    steps = []

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["read", "write\n```\n" + new_content + "\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "read_file",
                        "tool_args": {"path": "big.py"},
                    },
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "big.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: (
                (
                    existing.read_text(),
                    False,
                )
                if tc["tool_name"] == "read_file"
                else ('{"path": "big.py", "ok": true}', False)
            ),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    write_obs = steps[1]["observation"]
    assert "WARNING" in write_obs
    assert "+5 more" in write_obs


def test_overwrite_new_file_no_warning(tmp_path, monkeypatch):
    """Writing a brand-new .py file (no old content) produces no warning."""
    monkeypatch.chdir(tmp_path)
    steps = []

    new_content = "def test_new():\n    pass\n"

    with (
        patch(
            "datum.agent_loop._think",
            _mk_think(["write\n```\n" + new_content + "\n```", "done"]),
        ),
        patch(
            "datum.agent_loop._decide",
            _mk_decide(
                [
                    {
                        "action": "tool",
                        "tool_name": "write_to_file",
                        "tool_args": {"path": "new_test.py"},
                    },
                    {"action": "done", "summary": "ok"},
                ]
            ),
        ),
        patch(
            "datum.agent_loop._execute_tool",
            lambda tc, cfg: ('{"path": "new_test.py", "ok": true}', False),
        ),
    ):
        agent_loop("task", BASE_CFG, phase="act_red", on_step=steps.append)

    write_obs = steps[0]["observation"]
    assert "REMOVED" not in write_obs
