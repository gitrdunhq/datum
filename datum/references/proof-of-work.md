# Proof of Work

Every REFACTOR agent produces a `proof-of-work.md` alongside its implementation commit.
This is not a code artifact — it is a trust signal for the reviewer.

The proof of work answers: *what did the agent actually do, why did it make the choices
it made, and what did it deliberately leave out?* It gives the human reviewer something
to evaluate before reading the diff, and it gives future agents (and engineers) a record
of the reasoning behind the implementation.

Inspired by Symphony's "agents attach self-reflection to finished work."

---

## Required sections

```markdown
# Proof of Work: <task.id> — <task.title>

## What changed
<!-- 3-5 sentences. What was the state before; what is the state now. -->

## Why these choices
<!-- Key implementation decisions and why. If there were multiple valid approaches,
     name the one not chosen and explain the tradeoff. -->

## Properties satisfied
| Property ID | How it is satisfied | Test that verifies it |
|---|---|---|
| SAFE-001 | ... | RecordingSessionTests.swift:42 |

## What was deliberately excluded
<!-- ACs that are out of scope for this task, deferred items, simplifications made. -->

## Edge cases considered
<!-- Inputs or states considered and either handled or deemed out-of-scope. -->

## Known limitations
<!-- Anything a reviewer should know that isn't obvious from the code. -->
```

All sections are required. Empty sections must state "None" — not be omitted.

---

## Where it lives

The proof-of-work file is committed as part of the REFACTOR commit to a per-lane path:

```
.datum/runs/<RUN_ID>/proof-of-work/<task_id>.md
```

It is NOT committed to the main branch — it lives in the run archive. Reviewers
read it via `datum status --proof-of-work <task_id>` or by opening the archive directly.

---

## Contract addition

The REFACTOR result contract includes a `proof_of_work_path` field:

```json
{
  "contract_version": "1.0",
  "agent_role": "REFACTOR",
  "task_id": "task-001",
  "status": "done",
  "proof_of_work_path": ".datum/runs/epic-1-.../proof-of-work/task-001.md",
  ...
}
```

The orchestrator rejects a REFACTOR result with `status: done` that omits `proof_of_work_path`.
Missing proof of work is treated like a missing AC checklist — the stage is not marked complete.

---

## Review integration

During the Review phase, the review agent for the `correctness` domain reads the proof-of-work
alongside the diff. The "What was deliberately excluded" section is the primary input for
identifying scope gaps. The "Known limitations" section feeds directly into the Review findings.

---

## Quality gate

A proof-of-work section that contains only "N/A" or is copy-pasted from the task entry is a
brief defect. The Review agent flags this as a finding. Over time, patterns in proof-of-work
quality surface in Closeout as a measure of agent brief quality.
