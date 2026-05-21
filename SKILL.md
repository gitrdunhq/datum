---
name: datum
description: >
  Automates the full software delivery cycle using DATUM methodology — from brief to merged PR to closeout.
  Use this skill whenever the user says "datum go", "datum yolo", "datum refine", "datum plan", "datum act",
  "datum validate", "datum review", "datum pr-comments", "datum resume", "datum status", "datum init", 
  "datum closeout", "run the epic", "start the development cycle", "let's implement this spec", 
  "drive this ticket through to merge", or any phrase suggesting they want to run the DATUM workflow.
  Also activates automatically when TICKET.md, docs/TICKET.md, SPEC.md, docs/SPEC.md, docs/epics/*/TICKET.md, docs/epics/*/SPEC.md, or TASKS.md is present.
compatibility: "claude-code, codex, opencode, kiro, gemini-cli. Requires: git, python3. Optional: gitnexus-mcp, gh-cli."
---

# DATUM — Agentic Production Line

## Quick Start

```
/datum go          Run from current phase through merge, halt at gates
/datum yolo        Same but skip optional gates; halt only on hard stops
/datum <phase>     Run a single phase (refine, plan, properties, act, validate, review, pr-comments, closeout)
/datum resume      Resume from .datum/state.json after interruption
/datum status      Print current phase, RUN_ID, lane progress, last failure
/datum init        Bootstrap hooks, linter, GitNexus, CURRENT_STATE.md, ROADMAP.md
/datum doctor      Run `uv run scripts/datum.py datum.self_check` before a workflow run
/datum migrate     Upgrade state/artifact schemas across skill versions
/datum archive     Force-archive current RUN_ID
/datum reset       Discard current RUN_ID state (with confirmation)
/datum closeout [<run_id>] [--resume] [--synth-only]
/datum rollback <run_id>   Revert a merged epic and re-enter at PR Comments
/datum update "<request>" Post a /datum update comment on the open PR

### Product Pipeline (Pre-Dev)
/datum product go       Run Product Ideation (Triage -> Discovery -> Requirements -> Handoff)
/datum product <phase>  Run a single Product phase (triage, discovery, requirements, handoff)
/datum product status   Print current Product phase and run ID
```

Phrase triggers work on tools without slash commands:
`datum go`, `datum yolo`, `datum refine`, `datum plan`, `datum act`, etc.

---

## Dispatcher Logic

When DATUM is invoked, execute this sequence before doing any phase work:

### 0. Self-check Runtime Contracts

Run: `uv run scripts/datum.py datum.self_check`

If it fails, halt before touching the target repo. A failing self-check means the skill's
documented scripts, schemas, hooks, or contract fixtures drifted from the executable assets.

### 1. Load Config

Read `.datum/config.toml` if it exists; fall back to `datum/assets/config.toml.default`.
Model tier names resolve to actual model IDs via `[models]` table.

### 2. Read State

Run: `uv run scripts/datum.py datum.state read`

If state is absent or `run_id` is missing, detect entry point from artifacts.

First, resolve the current branch: `BRANCH=$(git rev-parse --abbrev-ref HEAD)`

| Artifact present | Entry point |
|---|---|
| `docs/TICKET.md` or `docs/epics/$BRANCH/TICKET.md` | **Refine** |
| `docs/epics/$BRANCH/SPEC.md` or `docs/SPEC.md` (no `TASKS.md`) | **Plan** |
| `TASKS.md` + `docs/epics/$BRANCH/PROPERTIES.md` | **Act** |
| Open PR URL provided | **PR Comments** |
| Nothing | Offer `datum init` or prompt for input |

All four epic artifacts live under `docs/epics/<branch>/` as permanent records — nothing is ever overwritten by a later epic:

```
docs/epics/<branch>/
  TICKET.md       ← moved from docs/TICKET.md during Refine
  SPEC.md         ← written by Refine
  TASKS.md        ← copied from root by Plan
  tasks.json      ← copied from root by Plan
  PROPERTIES.md   ← written by Properties
```

`TASKS.md` in the **repo root** is the live execution copy used by DATUM scripts — it is intentionally overwritten at the start of each new epic. The permanent record is always in `docs/epics/<branch>/`.

Generate a new `run_id`: `epic-{N}-{YYYYMMDD}-{hhmmss}` where N is the next epic number
(read from prior runs in `.datum/runs/` to determine N).

### 3. Detect Language

Run: `uv run scripts/datum.py datum.language_detect`

Returns the primary language. Maps to a language override file:
- `swift` → `datum/references/04-act-swift.md`
- `typescript` | `javascript` → `datum/references/04-act-typescript.md`
- `go` → `datum/references/04-act-go.md`
- `python` → `datum/references/04-act-python.md`
- Other → no language override (ACT agents use generic patterns)

### 4. Check GitNexus Availability

If the active tool supports GitNexus MCP: set `gitnexus_available = true`
Otherwise: set `gitnexus_available = false`, log degraded mode to state.

### 5. Determine Phase and Dispatch

For `datum go` / `datum yolo`: run from current phase through to Closeout.
For `datum <phase>`: run only that phase.

Load the phase reference doc and execute it:

| Phase | Reference Doc | Entry Condition | Extra references |
|---|---|---|---|
| Discovery | `datum/references/00-discovery.md` | Explicit `/datum discovery` | — |
| Refine | `datum/references/01-refine.md` | docs/TICKET.md present | — |
| Plan | `datum/references/02-plan.md` | docs/SPEC.md present | `datum/references/domain-wisdom.md` |
| Properties | `datum/references/03-properties.md` | TASKS.md present, no docs/PROPERTIES.md | — |
| Act | `datum/references/04-act.md` | TASKS.md + docs/PROPERTIES.md present | — |
| Validate | `datum/references/05-validate.md` | All lanes complete | — |
| Review | `datum/references/06-review.md` | Validate gate passed | `datum/references/domain-wisdom.md` |
| PR Comments | `datum/references/07-pr-comments.md` | PR open | — |
| Closeout | `datum/references/08-closeout.md` | PR merged | — |

**Product Pipeline (Pre-Dev) Phases:**
For `datum product go` or `datum product <phase>`, use `.datum/product_state.json` and `uv run scripts/datum.py datum.product_state`:

| Phase | Reference Doc | Entry Condition |
|---|---|---|
| Triage | `datum/references/p1-triage.md` | Initial ideation/request |
| Discovery | `datum/references/p2-discovery.md` | `docs/ideation/TRIAGE.md` present |
| Competitive | `datum/references/p2a-competitive.md` | OPTIONAL. Agent decides based on context, or user requests. |
| Stakeholder | `datum/references/p2b-stakeholder.md` | OPTIONAL. Agent decides based on context, or user requests. |
| Requirements | `datum/references/p3-requirements.md` | `docs/ideation/DISCOVERY.md` present |
| Handoff | `datum/references/p4-handoff.md` | `docs/ideation/PRD.md` present |

*Note on Optional Phases:* After `Discovery`, the agent must reason whether the project context warrants `Competitive` analysis or `Stakeholder` mapping. If it does, transition into those phases. If unclear, ask the user. If they are not needed, skip directly to `Requirements`.

For **Act**, also load:
- `datum/references/agent-contracts.md` — typed brief/result schemas for all agent roles
- `datum/references/brief-builder.md` — step-by-step context construction per role
- `datum/references/04-act-red-brief.md`, `datum/references/04-act-green-brief.md`, `datum/references/04-act-refactor-brief.md`
- `datum/references/04-act-green-multiturn.md` — multi-turn GREEN continuation protocol
- `datum/references/04-act-adversarial-brief.md` — adversarial agent run after REFACTOR
- `datum/references/04-act-completed-with-risks.md` — middle verdict when ACs pass but risks remain
- `datum/references/04-act-skeleton-preflight.md` — per-lane skeleton creator before RED
- `datum/references/proof-of-work.md` — required REFACTOR output alongside the commit
- `datum/references/spec-drift.md` — mid-ACT spec change detection and resolution
- `datum/references/quality-profiles.md` — repo-specific review dimensions (.datum/profiles/)
- Language override if detected
- `datum/references/pipeline-dispatch.md`
- `datum/references/gitnexus-playbook.md` (if gitnexus_available)

After each phase completes, run: `uv run scripts/datum.py datum.gate <phase> [--yolo]`
On gate pass: update state, archive artifacts, transition to next phase.
On gate fail: halt and surface the gate verdict to the user.

---

## Gate Policy

Gates are enforced by `datum/scripts/gate.py`. Each gate has a policy from config:

| Policy | Behavior |
|---|---|
| `required` | Always halts for human review. Never bypassed, even in yolo. |
| `skippable_if_complete` | LLM judge decides if existing artifact is sufficient to skip. Bypassed in yolo. |
| `skipped` | Never runs. |

**Per-phase gate matrix** — what stops in each mode:

| Phase gate | Default policy | `datum go` | `datum yolo` |
|---|---|---|---|
| `refine_human_review` | skippable_if_complete | halts | **skipped** |
| `plan_human_approval` | **required** | halts | **halts** |
| `properties_human_review` | skippable_if_complete | halts | **skipped** |
| `validate_human_review` | skippable_if_complete | halts | **skipped** |
| `triage_human_approval` | **required** | halts | **halts** |
| `merge_human_approval` | **required** | halts | **halts** |

`plan_human_approval` is the only pre-code gate that yolo cannot bypass — you always approve TASKS.md before agents write code.

**Hard stops** — enforced by hook/subprocess layer, never bypassed including in yolo:
- `tests_red_after_3x_retry` — ACT lane exhausted retry budget
- `hook_blocked_write` — layer boundary or banned pattern hook fired
- `merge_conflict` — never auto-resolved
- `git_push_rejected` — stale base or branch protection
- `schema_validation_failed` — artifact failed schema validation
- `gitnexus_high_risk_unconfirmed` — blast radius above threshold, not confirmed
- `gitnexus_unavailable_high_change_volume` — degraded mode, high volume, no human approval
- `external_dependency_install_proposed` — pip/npm/brew install intercepted
- `test_ratchet_violation` — pre-commit hook caught test weakening
- `lane_tool_sandbox_violation` — lane-tool exceeded permissions

---

## State File

Location: `.datum/state.json`
Schema: `datum/assets/schemas/state.schema.json`
Managed by: `uv run scripts/datum.py datum.state <read|write|transition|archive>`

Key fields used by the dispatcher:

```json
{
  "run_id": "epic-1-20260101-120000",
  "skill_version": "1.0.0",
  "current_phase": "act",
  "phases": { ... },
  "lanes": { ... },
  "in_flight_count": 2,
  "in_flight_cap": 7,
  "git": { "base_branch": "main", "work_branch": "datum/epic-1", "head_sha": "..." },
  "brief_defects": [],
  "lane_tools_added": [],
  "gitnexus_index_sha": "...",
  "gitnexus_degraded": false
}
```

---

## Artifact Archival

All phase outputs are archived to `.datum/runs/<RUN_ID>/`.
Run: `uv run scripts/datum.py datum.archive <run_id> <artifact_path>` after each phase.

`.datum/` is gitignored except for artifacts explicitly committed:
`docs/SPEC.md`, `TASKS.md`, `docs/PROPERTIES.md`, `CHANGELOG.md`, `CURRENT_STATE.md`,
`ROADMAP.md`, `RETRO.md`, `solutions/`.

---

## Token Efficiency

Agents have agency to write reusable helpers to `datum/scripts/lane-tools/`. Before starting
any lane, load the `datum/scripts/lane-tools/README.md` into the agent's brief so it knows
what tools already exist. After adding a tool, update the README and `datum/scripts/lane-tools/manifest.toml`.

Prefer structured tools over grep scans:
- Symbol lookup → GitNexus `context` or `impact`
- Caller discovery → GitNexus `impact` or an AST-based lane-tool
- Schema validation → run `datum/scripts/gate.py`, not LLM string matching

See `datum/references/token-efficiency.md` for per-phase notes and lane-tooling agency rules.

---

## GitNexus Integration

See `datum/references/gitnexus-playbook.md` for the full call table.

In degraded mode (GitNexus unavailable):
- Risk assessment uses heuristic volume threshold only
- Changes above threshold always escalate to human approval
- The skill never claims "low risk" without GitNexus data
- Grep/AST tools are used for lookups, never for risk assessment

---

## Cross-Tool Portability

This SKILL.md is tool-agnostic. Tool-specific subagent primitive names are in
`datum/assets/config.toml.default` under `[tools]`. The dispatcher uses whichever primitive
the active tool supports. Tools without parallel subagent primitives run lanes sequentially
and log the degradation.

---

## Bootstrap (`datum init`)

Run `datum init` on a fresh repo to set up:
1. `uv run scripts/datum.py datum.bootstrap.setup_symlinks` — symlink to skill assets
2. `uv run scripts/datum.py datum.bootstrap.install_hooks` — pre-commit hook suite
3. `uv run scripts/datum.py datum.bootstrap.install_linter_rules` — project linter config
4. `uv run scripts/datum.py datum.bootstrap.seed_state_docs` — CURRENT_STATE.md, ROADMAP.md stubs
5. `uv run scripts/datum.py datum.bootstrap.gitnexus_setup` — GitNexus analyze (if available)

All bootstrap steps require a single human approval gate before execution.
After approval, each step runs and confirms success before the next begins.

---

## Brief Construction Protocol

Before dispatching any ACT agent, the orchestrator builds its brief. The brief is the agent's entire working context — what it can see determines what it can do. **Get the brief wrong and the three-agent contract breaks down.**

Full templates and a worked example are in `datum/references/brief-builder.md`. Required reading before dispatching any lane agent.

**RED brief — minimum for red-phase isolation:**
1. Filter `docs/PROPERTIES.md` to only the property IDs assigned to this task (traceability table lookup)
2. Extract only the task's own entry from `TASKS.md` (title, ACs, files, red_note, introduces_stubs)
3. Fetch `gitnexus context` for each symbol the test will reference — attach the output directly
4. Append `datum/scripts/lane-tools/README.md` in full
5. For each dependency lane that has a stub commit: attach the stub file content
6. **Exclude:** any file in the test directory, implementation files for this task, other lanes' outputs

**GREEN brief — minimum to pass without seeing the test:**
1. Same SPEC, PROPERTIES (task-filtered), task entry, GitNexus context, lane-tools README as RED
2. Run `uv run scripts/datum.py datum.test_signal --framework <detected>` on the raw runner output → attach the `TestSignal` JSON
3. If `status = "redaction_failed"`: **halt the lane** — do not dispatch GREEN
4. **Exclude:** test source files, test names, RED brief, RED commit message, anything from `Tests/`

**REFACTOR brief — full context, no exclusions:**
1. Everything: SPEC, PROPERTIES, task entry, GitNexus impact (not just context — run `gitnexus impact` on all task files), lane-tools README
2. GREEN's implementation files (read current HEAD)
3. Test source files (REFACTOR is the only agent that sees them)
4. Full unredacted test results

One check before each dispatch: verify the brief does not contain a prohibited item. If the check fails, fix the brief before dispatching — never send a malformed brief and hope for the best.

---

## Failure Cascade Decision Tree

When a lane fails terminally (post-3x retry), the orchestrator must decide immediately — other lanes may be blocked waiting for this one.

```
Lane fails terminally
        │
        ├─ Does any in-flight or queued lane depend on this lane's behavior (GREEN commit)?
        │       │
        │       ├─ YES → Surface IMMEDIATELY (don't wait for sync point)
        │       │         Show: failed lane ID, dependent lane IDs, diagnostic packet
        │       │         Ask: retry | proceed without | halt pipeline
        │       │
        │       └─ NO  → Accumulate diagnostic packet; surface at sync point
        │
        ├─ datum yolo active?
        │       │
        │       ├─ YES → Accumulate without surfacing; log to state as failed_terminal
        │       │         At sync point: show all failed lanes together, require decision
        │       │
        │       └─ NO  → Surface immediately regardless of dependency status
        │
        └─ Post-decision actions:
                ├─ Retry: re-queue the lane; increment retry counter; re-run diagnose_failure.py
                ├─ Proceed: mark failed_terminal; continue pipeline without this lane's changes
                └─ Halt: stop all in-flight lanes; checkpoint state; await datum resume
```

A lane failure never auto-propagates to halt other lanes — the decision always goes to the orchestrator and then to the human if needed. Other lanes keep running until told otherwise.

---

## `datum status` — Live Pipeline View

`datum status` runs `uv run scripts/datum.py datum.status_render` which reads `.datum/state.json` and renders:

```
datum/epic-3 │ phase: ACT │ 5 lanes │ 2 in-flight │ 1 completed │ cap: 7
branch: datum/epic-3  head: a1b2c3d  run_id: epic-3-20260518-142200

LANE         STAGE      STATUS         NOTES
task-001  ── RED    ── committed   ── stub+test committed
          ── GREEN  ── committed   ── ✓ passing
          ── REFACTOR  in_progress ── attempt 1
task-002  ── RED    ── committed   ──
          ── GREEN  ── in_progress ── attempt 1 (REASONING retry)
task-003  ── RED    ── committed   ──
          ── GREEN  ── queued      ── blocked: task-001 behavior dep
task-004     queued                   blocked: file conflict → task-002
task-005  ── RED    ── committed   ──
          ── GREEN  ── committed   ──
          ── REFACTOR  committed   ── ✓ complete

gitnexus: degraded (grep/AST fallback)   flakies: 0/3
```

Run: `uv run scripts/datum.py datum.status_render [--json]` for the raw JSON version.
The `--json` form is used by CI and by other scripts; the rendered form is for humans.

---

## Error Recovery

See `datum/references/recovery-modes.md` for the full failure classification tree.

Quick reference:
- `ENVIRONMENTAL` failures → fix in place at same model tier, retry counter NOT incremented
- `REASONING` failures → enter retry ladder (same brief → Reasoning tier → verbose Reasoning)
- `UNKNOWN` failures → enter retry ladder conservatively, log new pattern

Run: `uv run scripts/datum.py datum.diagnose_failure <log_path>` to classify before retrying.

**Rollback (`datum rollback <run_id>`):**

See `datum/references/rollback.md` for the full 9-step protocol.
Short form: creates a revert commit, opens a new PR, and re-enters at Validate (confirm tests
pass on the reverted branch), then PR Comments. Does NOT re-run ACT.

**Crash recovery (`datum resume`):**

`datum resume` reads `.datum/state.json` and resumes exactly where execution stopped. Protocol:

1. Run `uv run scripts/datum.py datum.state read` — confirm state is valid and has a `run_id`
2. Check `current_phase`: resume at that phase's reference doc
3. For ACT specifically:
   - Lanes with `stage = completed` or `status = committed` for a stage: **do not re-run**
   - Lanes with `stage = in_progress`: re-classify as `queued` and re-dispatch (the previous agent crashed without committing)
   - Lanes with `stage = queued` or `blocked_on_*`: resume scheduler from current DAG state
   - Re-start the commit queue: `uv run scripts/datum.py datum.commit_queue --run-id <RUN_ID>`
4. For Closeout specifically: use `datum closeout --resume <run_id>` — each stage checks its `.done` marker and skips completed steps
5. Artifacts already committed to the branch are safe — `git log` is the ground truth; state.json reflects it

**What resume does NOT do:** re-run phases already marked `completed` in state. Gate validators run again to confirm artifacts are still valid; if they pass, the phase is skipped.

---

## Session-End Handoff

When the user says **"session end"**, **"wrapping up"**, **"let's stop here"**, or similar
mid-session exit phrases during an active DATUM run, write a handoff summary before the
session closes. This is distinct from Closeout — it captures interruption state, not
post-merge state.

Run: `uv run scripts/datum.py datum.state read` to get current state, then write to memory:

```
Session handoff — DATUM in-flight
  Run ID:         <run_id>
  Current phase:  <current_phase>
  Branch:         <git.work_branch>  head: <git.head_sha>
  Lane summary:   <per-lane stage + status, one line each>
  Decisions made this session: <key choices, approach selected in Plan, gate verdicts>
  Next action:    datum resume (or: datum <phase> to re-enter at specific phase)
```

Write to: `~/.claude/projects/<project-slug>/memory/datum-session-<YYYYMMDD-HHmmss>.md`
Use frontmatter: `type: project`, `name: datum-session-<timestamp>`.

This file is read automatically on the next `datum resume` and by the Dispatcher's
state-read step when no `run_id` is present in state.

---

## Version Migration

`datum migrate` runs `uv run scripts/datum.py datum.migrate` which reads the current `skill_version`
from state and applies incremental migrations to reach the current skill version.
