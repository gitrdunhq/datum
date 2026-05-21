# Multi-Turn GREEN Sessions

By default, when GREEN fails the orchestrator spawns a brand new agent with a fresh context.
This is safe but expensive: every retry re-sends the full SPEC excerpt, PROPERTIES, GitNexus
context, task entry, and lane-tools README — all of which are already in the thread history.

Multi-turn GREEN keeps the thread alive across attempts. Continuation turns send only the
updated `TestSignal` and a short re-orientation prompt. The full context is already present
in the thread and does not need to be re-transmitted.

Inspired by Symphony's continuation semantics: "The first turn should use the full rendered
task prompt. Continuation turns should send only continuation guidance to the existing thread,
not resend the original task prompt that is already present in thread history."

---

## When multi-turn applies

Multi-turn applies within a single session of attempts, up to `green_max_turns` (default: 3).
It is separate from — and runs before — the model-escalation retry ladder.

```
Turn 1 (full brief)  → FAIL
Turn 2 (continuation) → FAIL
Turn 3 (continuation) → FAIL
     ↓  max_turns exhausted
New agent, Reasoning tier, full brief  ← this is the old "attempt 2"
     ↓  still FAIL
New agent, Reasoning verbose           ← this is the old "attempt 3"
     ↓  still FAIL
HARD STOP: tests_red_after_3x_retry
```

`green_max_turns` counts turns within a session. The model-escalation ladder still applies
after the session exhausts its turns — they are orthogonal axes.

---

## First turn (unchanged)

The first turn uses the full brief exactly as defined in `references/04-act-green-brief.md`.
Nothing changes here.

---

## Continuation turn structure

When GREEN fails and `current_turn < green_max_turns`, send a continuation on the same thread:

```markdown
## Continuation: attempt <N> of <green_max_turns>

The previous attempt did not pass the tests. Here is the updated signal:

### Updated test signal
<new TestSignal JSON from test_signal.py>

### What changed since your last attempt
<diff of what you wrote vs. what was already there, if any>

### Reminder: files you may write to
<task.files — implementation only>

Try a different approach. The full task context is already in this thread.
```

**Do NOT re-send:** SPEC excerpt, PROPERTIES, GitNexus context, lane-tools README, task entry.
These are already in the thread. Re-sending them inflates context without adding information
and may cause the model to weight the repeated content disproportionately.

---

## Token savings profile

For a typical GREEN brief (SPEC excerpt ~800 tokens, PROPERTIES ~400, GitNexus ~600,
task entry ~200, lane-tools ~150):

- Full brief: ~2,150 tokens per attempt
- Continuation: ~300 tokens (new TestSignal + diff + re-orientation)
- 3-turn session savings vs. 3 fresh agents: ~3,700 tokens (~58% reduction)

At Standard tier rates over a 10-lane ACT phase with 2 GREEN retries per lane average,
this compounds significantly. Multi-turn GREEN is the highest-ROI token efficiency change
in the skill.

---

## Fail-closed behavior

If `test_signal.py` returns `redaction_failed` on any turn, the session halts immediately
regardless of remaining turns. The redaction failure rule takes precedence.

If the underlying thread crashes or times out mid-session, the orchestrator treats the
session as exhausted and escalates to a fresh agent at Reasoning tier — same as if all
turns had been used.

---

## Same-thread ≠ same-answer

Multi-turn does NOT violate the "same-agent retry is forbidden for GREEN" rule. That rule
was about preventing an agent from re-trying the same wrong approach by re-reading its
own wrong output. Continuation turns send a new TestSignal — the agent is responding to
new information, not re-reading its prior answer. Each turn is a fresh reasoning pass on
updated evidence.

---

## Config

```toml
[pipeline]
green_max_turns = 3  # turns per session before escalating to new Reasoning-tier agent
```

Set to `1` to disable multi-turn and return to the original single-turn-per-agent behavior.

---

## Stall detection integration

A continuation turn that produces no code changes and fails with the same error as the prior
turn is a stall signal. After two consecutive identical failures:
- Classify as REASONING failure (not ENVIRONMENTAL)
- End the session immediately (don't wait for remaining turns)
- Escalate to fresh Reasoning-tier agent

This prevents the session from burning all its turns on the same wrong approach.
