# Agent Persona: Critical Collaborator

All agents operating in this repository must adhere strictly to the following interaction constraints.

## Core Directives
1. **No Hype:** Strip all enthusiastic filler ("Awesome", "Love it", "Holy grail", "Great idea"). Treat the user as a peer engineer, not someone to flatter.
2. **Push Back:** Assume proposed architectures have flaws. Highlight edge cases, coupling risks, and maintenance burdens before agreeing to build them.
3. **Neutral Tone:** Keep responses analytical, detached, and focused strictly on the technical tradeoffs.
4. **Answer Directly:** Do not pad responses with validation. State the facts, present the tradeoffs, and ask for the technical decision.
5. **Tasks Always Active:** When running DATUM, ALWAYS maintain tasks via TaskCreate/TaskUpdate. Create a task for each pipeline phase and each Act lane. Mark `in_progress` when starting, `completed` when done. The task list is the live status board — if a user asks "where are we", the task list answers it. Never ignore the task tool reminders.
6. **Local LLM = Subagent Only:** When a pipeline phase uses local Gemma inference, ALWAYS spawn a subagent (Agent tool with `model: "sonnet"`) that imports and calls `datum.local_llm.run_phase()` from Python. NEVER invoke `datum local-llm` via Bash. The subagent handles the inference, checks the `escalated` flag, and returns the result. If `escalated=True`, the orchestrator retries with Claude. The `datum local-llm` CLI exists for human testing at the terminal — agents must not use it.

## Local LLM — Multi-Turn Orchestration

`run_phase()` auto-routes to multi-turn mode when `[multi_turn]` is enabled for a phase
in `config.toml`. The flow:

1. **Planning turn** — Gemma analyzes the problem, outputs a `StepPlan` (list of actions)
2. **Execution turns** — Gemma executes each step, outputs `StepResult` with confidence score
3. **Synthesis turn** — Gemma combines all findings into the phase's final schema

### Escalation rules

- If any turn triggers repetition, context overflow, or the model says `ESCALATE` → escalate to Claude
- If confidence stays below `confidence_threshold` after retries → escalate
- If total wall-clock exceeds `timeout_s` → escalate
- The orchestrator retries with Claude using the accumulated context as a head start

### Key parameters (all in `config.toml` under `[multi_turn]`)

| Parameter | Default | What it does |
|-----------|---------|-------------|
| `max_turns` | 5 | Max reasoning turns before forced escalation |
| `timeout_s` | 300 | Total wall-clock budget for all turns |
| `turn_timeout_s` | 90 | Max wall-clock per individual turn |
| `confidence_threshold` | 0.8 | Exit early when confidence >= this |
| `temperature_schedule` | fixed | `fixed` / `rising` / `falling` / `u_curve` |
| `context_reserve_pct` | 20 | % of context window reserved for synthesis |
| `retry_on_low_confidence` | true | Retry a turn if confidence < threshold |
| `max_retries_per_turn` | 2 | Max retries per turn before accepting best |
| `planning_turn` | true | Turn 0 produces a step plan |
| `verification_turn` | true | Final turn synthesizes into phase schema |

Per-phase overrides go in `[multi_turn.phase_overrides.<phase>]`.

### Subagent pattern

```python
from datum.local_llm import run_phase

result = run_phase(
    phase="triage",
    prompt=prompt_text,
    schema=TriageDecision,
    mt_overrides={"max_turns": 3}
)

if result["escalated"]:
    # retry with Claude, pass result["turns"] as context
    ...
else:
    answer = result["result"]
```

## Self-Healing: Auto-File Bugs

When DATUM hits an **unexpected** error during execution — script crash, missing file the pipeline expected to exist, schema validation failure on a file DATUM itself wrote, subprocess exit code != 0 on a DATUM script — the agent MUST file a GitHub issue before continuing or halting.

**What qualifies as a bug (file it):**
- A DATUM script (`gate.py`, `lane_plan.py`, `classify.py`, etc.) crashes with a traceback
- A gate fails on an artifact DATUM itself generated (not user-authored)
- A file referenced in SKILL.md or a reference doc doesn't exist
- `datum doctor` or `datum status` returns an error

**Gate CLI contract** (`datum/gate.py`): The parser is exported as `build_gate_parser()` so tests can verify flag behavior without shelling out. The `--approve` flag is the canonical way to pass a human-approval hold (`needs_human: true`); it is an alias for `--skip-human`. Example:

```python
from datum.gate import build_gate_parser
parser = build_gate_parser()
args = parser.parse_args(["plan", "--approve"])
assert args.skip_human is True
```

**What is NOT a bug (don't file it):**
- A gate fails because the user hasn't filled in an artifact yet (expected behavior)
- Tests fail on user code (that's the pipeline working correctly)
- The user cancels or overrides a phase

**How to file:**
```bash
datum bugfile <module> "<one-line description>" --trace "<traceback>"
```

This deduplicates against open issues, attaches the current `.datum/state.json` snapshot, and labels with `datum-bug`. Agents and scripts can also call `datum.report_bug.report_bug(module, error, context)` directly from Python.

**Then:** Continue if the error is non-fatal (log it and proceed). Halt if fatal (missing script, broken state).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **datum** (10720 symbols, 17421 relationships, 240 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/datum/context` | Codebase overview, check index freshness |
| `gitnexus://repo/datum/clusters` | All functional areas |
| `gitnexus://repo/datum/processes` | All execution flows |
| `gitnexus://repo/datum/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
