
## Local LLM — Multi-Turn Orchestration

When a pipeline phase uses local Gemma inference, ALWAYS spawn a subagent (Agent tool
with `model: "sonnet"`) that imports and calls `datum.local_llm.run_phase()` from Python.
NEVER invoke `datum local-llm` via Bash. The CLI exists for human testing only.

### How it works

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
    schema=TriageDecision,       # optional: Pydantic schema for structured output
    mt_overrides={"max_turns": 3} # optional: override any multi-turn param
)

if result["escalated"]:
    # retry with Claude, pass result["turns"] as context
    ...
else:
    answer = result["result"]
```
