# Phase: Review (The Swarm)

**Goal:** Produce a structured REVIEW-REPORT.md using a true parallel Map-Reduce Swarm architecture. This guarantees speed and prevents context saturation by isolating review domains into separate agent contexts.

## Inputs
- The work branch diff vs main (written to `.datum/runs/<RUN_ID>/diff.patch`)
- `SPEC.md`, `PROPERTIES.md`, `TASKS.md`
- GitNexus `impact` per finding (if available)

## Review Swarm Roles
Instead of a single sequential agent, the Pipeline Orchestrator spawns **N parallel agents** simultaneously. Each agent owns exactly one domain.

| Agent Role | Focus |
|---|---|
| **Security Agent** | OWASP top 10, injection, auth, secrets exposure |
| **Performance Agent** | Hot paths, N+1 queries, unbounded operations |
| **Architecture Agent** | Tier violations, coupling, layer boundary respect |
| **Correctness Agent** | Does the implementation match the SPEC and ACs? |

*(If `.datum/profiles/quality.yaml` exists, spawn agents based on its `review_dimensions` instead).*

## Execution Protocol

### Step 1: Prepare Context (Zero-Chat Handoff)
The Orchestrator MUST NOT inject the diff into the agent prompts.
1. **Pre-Review Rebase**: Navigate to the worktree (`cd .datum/worktrees/<RUN_ID>`), run `git fetch origin main`, and `git rebase origin/main` to ensure the Swarm does not review stale code against a shifting trunk.
2. Generate the diff: `git diff main...HEAD > .datum/runs/<RUN_ID>/diff.patch`
3. Prepare empty JSON packets for each domain in `.datum/runs/<RUN_ID>/review-packets/`

### Step 2: Fan-Out (Parallel Execution)
Spawn all agents simultaneously. Give each agent this exact instruction:
> "Read the diff from `.datum/runs/<RUN_ID>/diff.patch`. You are the `[DOMAIN]` reviewer. Write your findings to `.datum/runs/<RUN_ID>/review-packets/packet_[DOMAIN].json`. Do not communicate back via chat until the JSON is written."

Each finding in the packet:
```json
{
  "id": "SEC-001",
  "severity": "high|medium|low|info",
  "file": "Sources/...",
  "line": 42,
  "description": "...",
  "suggestion": "..."
}
```

### Step 3: Fan-In (Lead Synthesis & Deduplication)
Once all sub-agents complete, the Lead Reviewer (or deterministic script) synthesizes the packets.
Run `datum dedupe --input-dir .datum/runs/<RUN_ID>/review-packets/`.
- Consolidates duplicate findings.
- **Minority Protection:** If Security/Architecture flags something Correctness missed, the specialized finding is strictly protected.

### Step 4: Validate & Render
Run `datum gate validate-packets`.
Run `datum render --packets .datum/runs/<RUN_ID>/review-packets/ --output REVIEW-REPORT.md`

### Step 5: Satisfaction Loop (Saga Integration)
If `high` or `critical` findings exist:
1. **Remediation Package:** Run `datum remediate`.
2. **Loop:** Automatically dispatch targeted RED-GREEN-REFACTOR fixes.
3. **Saga Constraint:** Max 3 loops. If it fails on the 3rd loop, trigger the `04-Act` Saga Compensation (`git reset --hard`), increment the global `epic_retry_count`, and start the epic over. See `sagas.md`.

On pass (0 high/critical findings): transition to Closeout.
