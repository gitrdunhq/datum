"""ReAct agent loop: think → decide → assemble → execute → observe.

Each step in the pipeline does exactly one job, sized to the right model:

  THINK    (main model, freeform):   reason about the single next action.
                                     File content goes in a fenced code block.
  DECIDE   (fast model, structured): extract {action, tool_name, tool_args}
                                     from the thought — extraction, not reasoning.
  ASSEMBLE (Python, no model):       pull write content from the fenced block.
                                     No model ever transcribes file content.
  EXECUTE  (Python, no model):       run the tool via the lane-tools sandbox.
  OBSERVE  (Python, no model):       append truncated output to history; loop.

This replaces the analysis-oriented multi_turn_phase for agentic phases
(act_red, act_green, ...) where the model must drive tools to mutate a repo.
multi_turn_phase remains the engine for analysis phases (triage, validate).
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

from datum.local_llm import (
    WRITE_TOOLS,
    _execute_tool,
    _truncate_tool_output,
    generate,
    get_model_for_phase,
    load_config,
    structured,
)
from datum.schemas import AgentDecision

# Tool catalog: name → (args signature shown to the model, one-line description)
TOOL_CATALOG: dict[str, tuple[str, str]] = {
    "read_file": ('{"path": "<file>"}', "read a whole file"),
    "read_file_range": (
        '{"path": "<file>", "start_line": 1, "end_line": 50}',
        "read a line range",
    ),
    "list_dir": ('{"path": "."}', "list a directory"),
    "grep_search": (
        '{"pattern": "<regex>", "path": ".", "include": "*.py"}',
        "search file contents",
    ),
    "run_command": ('{"command": "pytest -q"}', "run a shell command"),
    "find_callers": ('{"symbol": "<name>"}', "find callers of a symbol"),
    "filter_gitnexus_output": (
        '{"query": "<text>"}',
        "filter GitNexus graph output",
    ),
    "write_to_file": (
        '{"path": "<file>"}',
        "create/overwrite a file — put the FULL content in a fenced code block",
    ),
    "replace_file_content": (
        '{"path": "<file>", "old_text": "<exact>", "new_text": "<exact>"}',
        "exact text replacement",
    ),
    "multi_replace_file_content": (
        '{"path": "<file>", "replacements": [{"old_text": "...", "new_text": "..."}]}',
        "several exact replacements",
    ),
}

# Anchored to the start of the response: a real reasoning block only ever
# opens as the first token of a turn. A <think> appearing later is content
# (e.g. a file that processes think tags) and must survive untouched —
# stripping it corrupted written files in transit. Also matches an UNCLOSED
# leading <think> (generation truncated mid-think): in that case everything
# after the tag is reasoning, never actionable output.
_THINK_TAG_RE = re.compile(r"\A\s*<think>.*?(?:</think>|\Z)", re.DOTALL)
# Fence regex: standard Markdown semantics — everything after ``` to end of
# line is the info string and is DISCARDED.  Content starts on the next line.
# The a4d815e regex tried to preserve content on the info line to fix a case
# where a model placed a docstring opener there (Defect-1), but that caused
# Run-5: a filename on the info line (```python tests/test_file.py) leaked
# into captured content as line 1, triggering invisible SyntaxErrors.
# Standard semantics is safe now because the ast syntax gate (also added in
# a4d815e) catches the Defect-1 case — the broken content gets REJECTED with
# feedback instead of landing on disk silently.
_FENCE_RE = re.compile(r"```[^\n]*\n(.*?)```", re.DOTALL)

MAX_OLD_OBSERVATION_CHARS = 400
MAX_RECENT_OBSERVATION_CHARS = 3000
# Shared cap for file content displayed to the model: both read_file
# observations and write_to_file echoes use this threshold.  A file fully
# echo-able on write is also fully viewable on read — eliminating the
# 3000-6000 byte deadlock band where a file was writable but marked as
# partially-read (and therefore un-overwritable).
MAX_FILE_ECHO_CHARS = 6000
RECENT_STEPS_KEPT_FULL = 2
LOOP_DETECT_REPEATS = 3

# Wall-clock budget enforcement (#61): below this floor a THINK call cannot
# do useful work, so the loop escalates instead of issuing a call that could
# overrun timeout_s by up to the HTTP request timeout.
MIN_STEP_BUDGET_S = 5.0
# Small grace past the deadline so a request finishing right at the wire
# isn't cut off mid-response.
BUDGET_SLACK_S = 2.0


def _strip_think_tags(text: str) -> str:
    """Remove Qwen3-style <think>...</think> blocks from model output."""
    return _THINK_TAG_RE.sub("", text)


def extract_fenced_content(thought: str) -> str | None:
    """Return the contents of the LAST fenced code block, or None.

    The last block wins: models often show the old file first, then the new.
    """
    matches = _FENCE_RE.findall(thought)
    if not matches:
        return None
    return matches[-1]


def assemble_tool_args(decision: dict, thought: str) -> dict:
    """Deterministically complete tool args from the thought text.

    For write_to_file without explicit content, inject the last fenced code
    block from the thought. This is the Python boundary: the fast model never
    transcribes file content, it only names the tool and the path.
    """
    args = dict(decision.get("tool_args") or {})
    if decision.get("tool_name") == "write_to_file" and "content" not in args:
        content = extract_fenced_content(thought)
        if content is not None:
            args["content"] = content
    return args


def _detect_removed_defs(old_content: str, new_content: str) -> list[str]:
    """Compare top-level function/class names between old and new Python source.

    Returns the names present in old_content but absent in new_content.
    If either file fails to parse, returns [] (skip comparison).
    """
    import ast as _ast

    def _top_level_names(source: str) -> set[str]:
        tree = _ast.parse(source)
        names: set[str] = set()
        for node in tree.body:
            if isinstance(
                node, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef)
            ):
                names.add(node.name)
        return names

    try:
        old_names = _top_level_names(old_content)
        new_names = _top_level_names(new_content)
    except SyntaxError:
        return []

    removed = sorted(old_names - new_names)
    return removed


def _check_py_syntax(content: str) -> SyntaxError | None:
    """Return the SyntaxError if content fails ast.parse, else None.

    Used as a pre-execution gate (Defect-2a): .py writes that don't parse
    are rejected before touching disk.
    """
    import ast as _ast

    try:
        _ast.parse(content)
    except SyntaxError as e:
        return e
    return None


def _lint_python(content: str) -> list[str]:
    """Deterministic content checks on written Python — the Tier-1 guards.

    Returns warning strings; each becomes part of the observation so the
    model must address them. Rules enforced here never spend prompt tokens.
    """
    import ast as _ast

    warnings: list[str] = []

    tree = None
    try:
        tree = _ast.parse(content)
    except SyntaxError as e:
        warnings.append(
            f"this file has a Python syntax error at line {e.lineno}: "
            f"{e.msg}. Re-read it and fix before proceeding."
        )

    if tree is not None:
        for node in _ast.walk(tree):
            if isinstance(node, _ast.Call):
                func = node.func
                if isinstance(func, _ast.Name) and func.id in ("eval", "exec"):
                    warnings.append(
                        f"line {node.lineno} uses {func.id}() — dynamic "
                        f"execution is banned (SEC-001). Use a safe alternative."
                    )
                if (
                    isinstance(func, _ast.Attribute)
                    and func.attr == "system"
                    and isinstance(func.value, _ast.Name)
                    and func.value.id == "os"
                ):
                    warnings.append(
                        f"line {node.lineno} uses os.system — banned "
                        f"(SEC-001). Use subprocess.run with a list argv."
                    )
                for kw in node.keywords:
                    if (
                        kw.arg == "shell"
                        and isinstance(kw.value, _ast.Constant)
                        and kw.value.value is True
                    ):
                        warnings.append(
                            f"line {node.lineno} uses shell=True — banned "
                            f"(SEC-001). Pass argv as a list instead."
                        )
            if isinstance(node, _ast.ExceptHandler) and node.type is None:
                warnings.append(
                    f"line {node.lineno} has a bare except — errors must "
                    f"never be silently swallowed (DPS-203). Catch specific "
                    f"exceptions and handle or re-raise."
                )

    line_count = content.count("\n") + 1
    if line_count > 500:
        warnings.append(
            f"file is {line_count} lines — hard cap is 500 (DPS-103). "
            f"Split along functional seams."
        )

    if "/tmp" in content:
        warnings.append(
            "file references /tmp — banned (cleared on reboot). Use a "
            "project-local directory instead."
        )

    return warnings


def _compact_history(history: list[dict]) -> list[dict]:
    """Collapse the working history into one digest entry.

    Used when the context monitor trips: the full log is already
    checkpointed, so the prompt only needs a one-line-per-step digest.
    """
    digest_lines = []
    for i, step in enumerate(history):
        args = json.dumps(step.get("tool_args", {}))[:60]
        obs = step.get("observation", "").replace("\n", " ")[:80]
        digest_lines.append(
            f"step {i + 1}: {step.get('tool_name', '?')}({args}) -> {obs}"
        )
    return [
        {
            "thought": "",
            "tool_name": "checkpoint",
            "tool_args": {},
            "observation": (
                "Context was compacted to stay within budget. "
                "Digest of prior steps:\n" + "\n".join(digest_lines)
            ),
        }
    ]


class _TranscriptWriter:
    """Append-only JSONL transcript for one episode (phase run).

    Writes to .datum/transcripts/<timestamp>-<episode>.jsonl under cwd.
    All writes are wrapped in try/except OSError so logging never crashes
    the loop.
    """

    CONTENT_TRUNCATE = 500
    OBSERVATION_TRUNCATE = 1000

    def __init__(self, episode: str) -> None:
        self._episode = episode
        self._path: Path | None = None
        ts = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        try:
            transcript_dir = Path(".datum") / "transcripts"
            transcript_dir.mkdir(parents=True, exist_ok=True)
            self._path = transcript_dir / f"{ts}-{episode}.jsonl"
        except OSError:
            pass

    def log_step(
        self,
        step_index: int,
        think_raw: str,
        decide_raw: dict,
        tool_name: str,
        tool_args: dict,
        observation: str,
    ) -> None:
        if self._path is None:
            return
        try:
            # Truncate content field in tool_args for sanity
            args_copy = dict(tool_args)
            if (
                "content" in args_copy
                and len(args_copy["content"]) > self.CONTENT_TRUNCATE
            ):
                args_copy["content"] = (
                    args_copy["content"][: self.CONTENT_TRUNCATE] + "...[truncated]"
                )
            obs = observation
            if len(obs) > self.OBSERVATION_TRUNCATE:
                obs = obs[: self.OBSERVATION_TRUNCATE] + "...[truncated]"

            record = {
                "step": step_index,
                "episode": self._episode,
                "think_raw": think_raw,
                "decide_raw": decide_raw,
                "tool_name": tool_name,
                "tool_args": args_copy,
                "observation": obs,
            }
            with self._path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, default=str) + "\n")
        except OSError:
            pass


def _write_checkpoint(
    phase: str, task: str, steps: list[dict], read_paths: set[str]
) -> Path:
    """Persist full loop state to .datum/ so a killed run can resume."""
    datum_dir = Path(".datum")
    datum_dir.mkdir(exist_ok=True)
    path = datum_dir / f"agent-checkpoint-{phase}.json"
    path.write_text(
        json.dumps(
            {
                "phase": phase,
                "task": task,
                "steps_taken": len(steps),
                "steps": steps,
                "read_paths": sorted(read_paths),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            indent=2,
        )
        + "\n"
    )
    return path


def load_project_rules(repo_dir) -> str:
    """Read the target repo's agent rules — AGENTS.md preferred, CLAUDE.md
    fallback — and distill to rule-like lines (bullets, numbered, headers).

    Capped at 2000 chars so project rules can't crowd out the loop's own
    instructions on a small model.
    """
    repo_dir = Path(repo_dir)
    source = None
    for name in ("AGENTS.md", "CLAUDE.md"):
        candidate = repo_dir / name
        if candidate.is_file():
            source = candidate
            break
    if source is None:
        return ""

    rule_lines = []
    for line in source.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if stripped.startswith(("-", "*", "#")) or re.match(r"\d{1,2}[.)]\s", stripped):
            rule_lines.append(stripped)

    text = "\n".join(rule_lines)
    return text[:2000]


def _catalog_lines(allowed_tools: list[str]) -> str:
    lines = []
    for name in allowed_tools:
        sig, desc = TOOL_CATALOG.get(name, ("{}", ""))
        lines.append(f"  {name} {sig} — {desc}")
    return "\n".join(lines)


def _render_history(history: list[dict]) -> str:
    """Render prior steps; full observations for recent steps, stubs for old."""
    if not history:
        return "(no steps taken yet)"
    lines = []
    cutoff = len(history) - RECENT_STEPS_KEPT_FULL
    for i, step in enumerate(history):
        args_str = json.dumps(step.get("tool_args", {}))
        if len(args_str) > 200:
            args_str = args_str[:200] + "...}"
        lines.append(f"Step {i + 1}: {step.get('tool_name', '?')} {args_str}")
        obs = step.get("observation", "")
        limit = (
            MAX_RECENT_OBSERVATION_CHARS if i >= cutoff else MAX_OLD_OBSERVATION_CHARS
        )
        if len(obs) > limit:
            obs = obs[:limit] + f"\n... [{len(obs) - limit} chars omitted]"
        lines.append(f"  result: {obs}")
    return "\n".join(lines)


def _build_system_prompt(allowed_tools: list[str], extra_rules: str = "") -> str:
    """Static per-run system prompt: role, tool catalog, code rules.

    Stable across turns so the inference server's prefix cache can reuse it.
    Kept to ~6 rules — instruction-following degrades with rule count on
    small models. extra_rules carries the target repo's own AGENTS.md /
    CLAUDE.md distillate (see load_project_rules).
    """
    project_section = (
        f"\n\nPROJECT RULES (from the repository's agent instructions):\n{extra_rules}"
        if extra_rules
        else ""
    )
    return (
        "You are a coding agent working inside a repository. "
        "You accomplish tasks by calling tools, one per step.\n\n"
        f"TOOLS (name, args, purpose):\n{_catalog_lines(allowed_tools)}\n\n"
        "RULES:\n"
        "1. Read a file before you overwrite it (enforced).\n"
        "2. When writing a file, output the COMPLETE file content in one "
        "fenced code block (```...```), then name the tool and path.\n"
        "3. After a successful write, never rewrite the same file — verify "
        "with run_command or declare DONE.\n"
        "4. Update any comment or docstring your change makes false.\n"
        "5. Match the existing code style; make the smallest change that "
        "accomplishes the task; no new files unless the task requires them.\n"
        "6. Never remove existing tests or functions unless the task says so."
        f"{project_section}\n\n"
        "RESPONSE FORMAT — every response has exactly these three sections, "
        "in this order, all three always present:\n"
        "REASONING: 2-5 sentences on the single next action.\n"
        "FILE: if the action writes a file, the COMPLETE updated file in one "
        "fenced code block; otherwise the single word NONE.\n"
        "NEXT: <tool_name> <json args without file content> | NEXT: DONE\n\n"
        "EXAMPLE RESPONSE:\n"
        "REASONING: The tests expect a greet function that calculator.py "
        "does not define yet. I have read both files, so I can write the "
        "complete updated module now.\n"
        "FILE:\n"
        "```python\n"
        '"""Calculator module."""\n\n\n'
        "def greet(name: str) -> str:\n"
        '    return f"hello {name}"\n'
        "```\n"
        'NEXT: write_to_file {"path": "calculator.py"}'
    )


def _build_think_prompt(task: str, history: list[dict]) -> str:
    return (
        f"TASK:\n{task}\n\n"
        f"STEPS SO FAR:\n{_render_history(history)}\n\n"
        "Respond with all three sections — REASONING, FILE, NEXT — per the "
        "RESPONSE FORMAT. For a write action, FILE carries the COMPLETE "
        "updated file content in one fenced code block (```...```) — the "
        "write sends exactly that block, nothing else. For any other "
        "action, FILE is NONE."
    )


def _build_decide_prompt(thought: str, allowed_tools: list[str]) -> str:
    # The decision lives at the end of the thought; the tail is enough and
    # keeps the fast model's prompt small. File content is NOT extracted here.
    tail = thought[-1500:]
    return (
        "Extract the next action from this agent reasoning. You are an "
        "extractor, not a decider — report what the reasoning chose.\n\n"
        f"REASONING (tail):\n{tail}\n\n"
        f"Valid tool names: {', '.join(allowed_tools)}\n"
        'If the reasoning says DONE, output {"action": "done", "summary": "..."}.\n'
        'Otherwise output {"action": "tool", "tool_name": "...", "tool_args": {...}}.\n'
        "For write_to_file, tool_args contains ONLY the path — never the content.\n\n"
        'Example — reasoning ends with \'NEXT: run_command {"command": "pytest -q"}\':\n'
        '{"action": "tool", "tool_name": "run_command", '
        '"tool_args": {"command": "pytest -q"}, "summary": ""}\n\n'
        "Example — reasoning ends with 'NEXT: DONE':\n"
        '{"action": "done", "tool_name": "", "tool_args": {}, '
        '"summary": "All tests pass after adding the function."}\n\n'
        "Output only the JSON."
    )


# Qwen3-2507 card sampling. The server does not read generation_config.json,
# so omitting these means top_p=1.0/top_k=off — measured cause of the
# 3x-identical-pytest repetition loop on the 4bit-DWQ build.
THINK_SAMPLING = {"top_p": 0.8, "top_k": 20, "min_p": 0, "presence_penalty": 1.0}


def _think(
    prompt: str,
    model_id: str,
    max_tokens: int,
    system: str | None = None,
    sampling: dict | None = None,
    max_time_s: float | None = None,
) -> dict:
    # THINK_SAMPLING is Qwen-2507 tuning; a config can route a different
    # model to the think tier and carry its own sampling via think_sampling.
    # max_time_s caps the HTTP request at the loop's remaining budget (#61).
    return generate(
        prompt,
        model_id,
        max_tokens=max_tokens,
        temperature=0.7,
        system=system,
        sampling=sampling or THINK_SAMPLING,
        max_time_s=max_time_s,
    )


def _decide(prompt: str, model_id: str, max_time_s: float | None = None) -> dict:
    # Extraction is classification — temperature 0 is free accuracy.
    # 1200 tokens: replace_file_content args carry old_text/new_text spans;
    # 400 truncated mid-JSON on multi-line replacements.
    return structured(
        prompt,
        AgentDecision,
        model_id,
        max_tokens=1200,
        temperature=0.0,
        max_time_s=max_time_s,
    )


def agent_loop(task: str, config: dict, phase: str = "agent", on_step=None) -> dict:
    """Run the ReAct loop until done, max_steps, timeout, or loop detection.

    on_step, if given, is called with each completed step dict (thought,
    tool_name, tool_args, observation) — for live progress reporting.

    Returns {"result": {"summary": str} | None, "escalated": bool,
             "reason": str | None, "phase": str, "steps_taken": int,
             "steps": list, "total_tokens": int, "total_time_s": float}.
    """
    base = load_config()
    think_model = config.get("think_model") or base.get("model")
    decide_model = (
        config.get("decide_model")
        or base.get("fast_model")
        or get_model_for_phase(phase)
    )
    max_steps = config.get("max_steps", 10)
    timeout_s = config.get("timeout_s", 600)
    think_max_tokens = config.get("think_max_tokens", 2048)
    allowed_tools = config.get("allowed_tools", list(TOOL_CATALOG))

    history: list[dict] = []  # working set — compacted when the monitor trips
    steps_log: list[dict] = []  # append-only full log — returned + checkpointed
    total_tokens = 0
    start = time.monotonic()
    recent_signatures: list[str] = []
    read_paths: set[str] = set()  # FULL untruncated reads — whole-file-write OK
    partial_read_paths: set[str] = set()  # truncated/range reads — replace only
    context_window = config.get("context_window") or base.get("context_window", 32768)
    checkpoint_pct = config.get("context_checkpoint_pct", 0.8)
    system_prompt = _build_system_prompt(
        allowed_tools, extra_rules=config.get("extra_rules", "")
    )
    transcript = _TranscriptWriter(phase)
    # No-progress breaker state: fires once per episode when consecutive
    # steps repeat the same (tool, args) AND observation identically.
    _prev_signature: str | None = None
    _prev_observation: str | None = None
    _no_progress_fired = False

    def _finish(summary: str | None, escalated: bool, reason: str | None) -> dict:
        return {
            "result": {"summary": summary} if summary is not None else None,
            "escalated": escalated,
            "reason": reason,
            "phase": phase,
            "steps_taken": len(steps_log),
            "steps": steps_log,
            "total_tokens": total_tokens,
            "total_time_s": round(time.monotonic() - start, 2),
        }

    for _step in range(max_steps):
        remaining_s = timeout_s - (time.monotonic() - start)
        if remaining_s < MIN_STEP_BUDGET_S:
            # Budget gone (or too thin for useful work): escalate instead of
            # issuing a THINK that could overrun timeout_s by up to the HTTP
            # request timeout (#61).
            return _finish(None, True, "timeout_exceeded")

        try:
            # ── THINK (main model, freeform) ─────────────────────────────
            think_prompt = _build_think_prompt(task, history)
            think_out = _think(
                think_prompt,
                think_model,
                think_max_tokens,
                system_prompt,
                sampling=config.get("think_sampling"),
                max_time_s=remaining_s + BUDGET_SLACK_S,
            )
            total_tokens += think_out.get("tokens", 0)
            think_raw = think_out.get("text", "")
            thought = _strip_think_tags(think_raw)

            # ── Context monitor: checkpoint + compact at the threshold ───
            prompt_tokens = think_out.get("prompt_tokens") or (
                (len(system_prompt) + len(think_prompt)) // 4
            )
            if prompt_tokens >= context_window * checkpoint_pct and len(history) > 1:
                _write_checkpoint(phase, task, steps_log, read_paths)
                history = _compact_history(history)

            if not thought.strip():
                # Generation truncated mid-<think>: nothing actionable —
                # feed the problem back instead of letting DECIDE hallucinate.
                step_entry = {
                    "thought": "",
                    "tool_name": "truncated_thought",
                    "tool_args": {},
                    "observation": (
                        "Your reasoning was cut off before stating an action. "
                        "Be more concise: think briefly, then end with the "
                        "NEXT: line."
                    ),
                }
                history.append(step_entry)
                steps_log.append(step_entry)
                if on_step:
                    on_step(step_entry)
                transcript.log_step(
                    _step,
                    think_raw,
                    {},
                    "truncated_thought",
                    {},
                    step_entry["observation"],
                )
                continue

            # ── DECIDE (fast model, structured) ──────────────────────────
            # Re-measure the budget — THINK may have consumed most of it.
            # Floored at MIN_STEP_BUDGET_S so the thought is never wasted:
            # worst-case overrun is bounded by floor + slack, not the full
            # HTTP request timeout.
            decide_remaining_s = timeout_s - (time.monotonic() - start)
            decide_prompt = _build_decide_prompt(thought, allowed_tools)
            decide_out = _decide(
                decide_prompt,
                decide_model,
                max_time_s=max(decide_remaining_s, MIN_STEP_BUDGET_S) + BUDGET_SLACK_S,
            )
            total_tokens += decide_out.get("tokens", 0)
            decision = decide_out.get("data") or {}
        except Exception as e:
            # Model/server failures (connection refused, malformed grammar
            # output, timeouts) become a structured escalation, never a crash.
            return _finish(None, True, f"exception: {e}")

        if decision.get("action") == "done":
            steps_log.append(
                {
                    "thought": thought,
                    "tool_name": "done",
                    "tool_args": {},
                    "observation": decision.get("summary", ""),
                }
            )
            if on_step:
                on_step(steps_log[-1])
            transcript.log_step(
                _step, think_raw, decision, "done", {}, decision.get("summary", "")
            )
            return _finish(decision.get("summary", ""), False, None)

        tool_name = decision.get("tool_name", "")

        # ── ASSEMBLE (Python boundary) ───────────────────────────────────
        tool_args = assemble_tool_args(decision, thought)

        target = Path(str(tool_args.get("path", "")))
        resolved = str(target.resolve())

        if tool_name not in allowed_tools:
            observation = (
                f"Error: '{tool_name}' is not a valid tool. "
                f"Valid tools: {', '.join(allowed_tools)}."
            )
        elif tool_name in WRITE_TOOLS and not tool_args.get("path"):
            observation = (
                f"Error: {tool_name} requires a 'path' argument naming the target file."
            )
        elif tool_name == "write_to_file" and "content" not in tool_args:
            observation = (
                f"Error: the file was NOT modified. write_to_file requires "
                f"the full file content in a fenced code block (```...```) "
                f"in your reasoning. Emit the complete updated "
                f"'{tool_args.get('path')}' inside one fenced block, then "
                f"retry the write. Do not declare DONE — the task is not "
                f"complete until the write succeeds."
            )
        elif (
            tool_name == "write_to_file"
            and target.exists()
            and resolved not in read_paths
        ):
            # Whole-file overwrite needs a FULL view of the current file.
            if resolved in partial_read_paths:
                observation = (
                    f"Error: you have only a truncated/partial view of "
                    f"'{tool_args.get('path')}'. A whole-file overwrite would "
                    f"lose content you have not seen — use "
                    f"replace_file_content for surgical edits instead."
                )
            else:
                observation = (
                    f"Error: '{tool_args.get('path')}' exists but you have "
                    f"not read it this session. Call read_file on it first, "
                    f"then write the updated COMPLETE content."
                )
        elif (
            tool_name in WRITE_TOOLS
            and tool_name != "write_to_file"
            and target.exists()
            and resolved not in read_paths
            and resolved not in partial_read_paths
        ):
            # Surgical edits still require having seen the file at all.
            observation = (
                f"Error: '{tool_args.get('path')}' exists but you have not "
                f"read it this session. Call read_file on it first."
            )
        elif (
            tool_name == "write_to_file"
            and "content" in tool_args
            and target.exists()
            and tool_args["content"]
            == target.read_text(encoding="utf-8", errors="replace")
        ):
            # Run-5 fix: idempotent-write short-circuit.  When the new
            # content is byte-identical to what is already on disk, skip
            # the write and tell the model to stop.  This deterministically
            # breaks the rewrite-the-same-file loop before the loop
            # detector has to fire.  Count as a successful read so further
            # writes are not blocked by the read-before-write guard.
            read_paths.add(resolved)
            observation = (
                "File already contains exactly this content — write "
                "skipped, nothing changed. The file is complete; "
                "DO NOT write it again. Proceed to the next action "
                "or call done."
            )
        elif (
            tool_name == "write_to_file"
            and str(target).endswith(".py")
            and "content" in tool_args
            and (se := _check_py_syntax(tool_args["content"])) is not None
        ):
            # Defect-2a: reject .py writes that fail ast.parse — broken
            # Python must never land on disk where it becomes an opaque
            # collection error that the model cannot self-correct from.
            # Run-5 fix: show what line 1 actually contains so a model
            # whose own emission was valid can see extraction artifacts.
            captured_line1 = tool_args["content"].split("\n", 1)[0]
            line1_diag = (
                f" Captured line 1 was: {captured_line1!r:.120}."
                if se.lineno == 1
                else ""
            )
            observation = (
                f"Error: file was NOT written to disk — Python syntax "
                f"error at line {se.lineno}: {se.msg}.{line1_diag} "
                f"Re-emit the full corrected file in one fenced code "
                f"block and retry write_to_file."
            )
        else:
            # Snapshot old content for overwrite-loss detection (Defect-3).
            _old_py_content: str | None = None
            if (
                tool_name == "write_to_file"
                and str(target).endswith(".py")
                and target.exists()
                and "content" in tool_args
            ):
                try:
                    _old_py_content = target.read_text(
                        encoding="utf-8", errors="replace"
                    )
                except OSError:
                    pass

            # ── EXECUTE (sandboxed, deterministic) ───────────────────────
            tool_output, exec_truncated = _execute_tool(
                {"tool_name": tool_name, "tool_args": tool_args}, config
            )
            # read_file observations use the file-echo cap so any file
            # fully echo-able on write is also fully viewable on read —
            # prevents the 3000-6000 byte deadlock band.  Other tools
            # (run_command, etc.) use the tighter observation cap.
            obs_cap = (
                MAX_FILE_ECHO_CHARS
                if tool_name == "read_file"
                else MAX_RECENT_OBSERVATION_CHARS
            )
            observation, obs_truncated = _truncate_tool_output(tool_output, obs_cap)
            if tool_name == "read_file" and tool_args.get("path"):
                if exec_truncated or obs_truncated:
                    partial_read_paths.add(resolved)
                else:
                    read_paths.add(resolved)
            if tool_name == "read_file_range" and tool_args.get("path"):
                partial_read_paths.add(resolved)
            if tool_name == "write_to_file" and '"ok": true' in tool_output:
                # Echo what landed on disk so the model never rewrites blind;
                # a successful write also counts as having read the file.
                read_paths.add(str(target.resolve()))
                content = tool_args.get("content", "")
                observation += (
                    f"\nFile content now on disk:\n{content[:MAX_FILE_ECHO_CHARS]}"
                )
                if len(content) > MAX_FILE_ECHO_CHARS:
                    # A silently cut-off echo reads as a failed write to
                    # literal models, which then rewrite the file forever.
                    observation += (
                        f"\n[echo truncated for display — the COMPLETE file "
                        f"({len(content)} chars) was written to disk "
                        f"successfully. Do NOT rewrite it because the echo "
                        f"above is cut off.]"
                    )
                # Tier-1 lint gate: deterministic content checks, surfaced
                # immediately instead of waiting for a test run.
                if str(target).endswith(".py"):
                    for warning in _lint_python(content):
                        observation += f"\nWARNING: {warning}"

                # Defect-3: overwrite-loss detection — warn when an
                # overwrite removes top-level definitions so the model
                # can self-correct before GREEN becomes unwinnable.
                if _old_py_content is not None:
                    removed = _detect_removed_defs(_old_py_content, content)
                    if removed:
                        shown = removed[:10]
                        suffix = (
                            f" +{len(removed) - 10} more" if len(removed) > 10 else ""
                        )
                        observation += (
                            f"\nWARNING: this overwrite REMOVED "
                            f"{len(removed)} top-level definitions that "
                            f"existed before: {', '.join(shown)}"
                            f"{suffix}. If that was unintentional, "
                            f"re-emit the COMPLETE file including them."
                        )

        # ── No-progress breaker (fires once, before loop detector) ───────
        signature = f"{tool_name}:{json.dumps(tool_args, sort_keys=True)}"
        if (
            not _no_progress_fired
            and _prev_signature is not None
            and signature == _prev_signature
            and _prev_observation is not None
            and observation == _prev_observation
        ):
            _no_progress_fired = True
            observation += (
                "\n\nYou have repeated the same action with the same result. "
                "Repeating it again will not change anything. If tests are "
                "failing, the next action MUST be write_to_file (or "
                "replace_file_content) with the code change that fixes them. "
                "Do not run the tests again until you have changed a file."
            )
        _prev_signature = signature
        _prev_observation = observation

        # ── OBSERVE ──────────────────────────────────────────────────────
        step_entry = {
            "thought": thought,
            "tool_name": tool_name,
            "tool_args": tool_args,
            "observation": observation,
        }
        history.append(step_entry)
        steps_log.append(step_entry)
        if on_step:
            on_step(step_entry)

        # ── Transcript logging (always-on, never crashes) ────────────────
        transcript.log_step(
            _step, think_raw, decision, tool_name, tool_args, observation
        )

        # Loop detection: identical (tool, args) repeated with no progress
        recent_signatures.append(signature)
        if (
            len(recent_signatures) >= LOOP_DETECT_REPEATS
            and len(set(recent_signatures[-LOOP_DETECT_REPEATS:])) == 1
        ):
            return _finish(None, True, "loop_detected")

    return _finish(None, True, "max_steps_exhausted")
