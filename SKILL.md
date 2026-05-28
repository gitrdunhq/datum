---
name: datum
description: >
  Automates the full software delivery cycle — brief to merged PR to closeout.
  Triggers: "datum go", "datum yolo", "datum <phase>", "datum resume", "datum status",
  "datum init", "run the epic", "start the development cycle", "let's implement this spec".
  Also activates when docs/epics/*/TICKET.md, docs/epics/*/SPEC.md, or TASKS.md is present.
compatibility: "claude-code, codex, opencode, kiro, gemini-cli. Requires: git, python3."
---

# DATUM — Agentic Production Line

## Commands

```
/datum go          Run from current phase through merge. Halt at gates.
/datum yolo        Skip optional gates. Hard stops still halt.
/datum <phase>     Run one phase: refine, plan, act, validate, review, closeout, etc.
/datum resume      Resume from .datum/state.json after interruption.
/datum status      Print phase, RUN_ID, lane progress, last failure.
/datum init        Bootstrap repo: hooks, linter, AGENTS.md, CURRENT_STATE.md, ROADMAP.md.
/datum rollback    Revert a merged epic. See references/rollback.md.
```

## Rule: Determinism

Orchestration is deterministic. State, transitions, routing, gates — all enforced by Python scripts. No improvisation. The LLM works within one phase. It does not decide pipeline structure or skip steps. If you are parsing history to figure out where you are, read the state file.

## Dispatcher

Execute in order before any phase work:

**0. Branch Guard** — If on `main`/`master`, auto-create `datum/epic-{N}` and switch. No exceptions.

**0.5. Self-check** — `uv run scripts/datum.py datum.self_check`. If it fails, halt.

**1. Load Config** — `.datum/config.toml`, falling back to `assets/config.toml.default`.

**2. Read State** — `uv run scripts/datum.py datum.state read`. If no state, detect entry:

| Artifact | Entry |
|---|---|
| `docs/epics/$BRANCH/TICKET.md` | Refine |
| `docs/epics/$BRANCH/SPEC.md` (no TASKS.md) | Plan |
| `TASKS.md` + PROPERTIES.md | Act |
| PR URL | PR Comments |
| Nothing | Offer `datum init` |

Epic artifacts always live at `docs/epics/<branch>/`. Never `docs/TICKET.md`.

**3. Detect Language** — `uv run scripts/datum.py datum.language_detect`. Maps to `references/04-act-{lang}.md`.

**4. Resolve Tier** — `resolve_tier(phase)` returns `{phase, tier, model}` from config. See `references/model-tiers.md`.

**5. Dispatch Phase** — Load the reference doc, execute it, run the gate.

| Phase | Reference | Gate |
|---|---|---|
| Discovery | `00-discovery.md` | — |
| Refine | `01-refine.md` | skippable |
| Plan | `02-plan.md` | **required** |
| Triage | `02.5-triage.md` | **required** |
| Deepen | `02.8-deepen.md` | skipped if triage routes to properties |
| Properties | `03-properties.md` | skippable |
| Architect | `03.5-architect.md` | blocks if ADRs missing |
| Act | `04-act.md` | per-lane retry ladder |
| Validate | `05-validate.md` | skippable |
| Review | `06-review.md` | max 3 iterations |
| PR Comments | `07-pr-comments.md` | — |
| Closeout | `08-closeout.md` | — |

After each phase: `uv run scripts/datum.py datum.gate <phase> [--yolo]`

For Act, also load: `agent-contracts.md`, `brief-builder.md`, `04-act-red-brief.md`, `04-act-green-brief.md`, `04-act-refactor-brief.md`, `04-act-adversarial-brief.md`, `04-act-skeleton-preflight.md`, `pipeline-dispatch.md`, `proof-of-work.md`, `spec-drift.md`, `quality-profiles.md`, language override, `gitnexus-playbook.md` (if available).

## Gates

| Gate | Policy | yolo? |
|---|---|---|
| `refine_human_review` | skippable_if_complete | skipped |
| `plan_human_approval` | **required** | **halts** |
| `triage_human_approval` | **required** | **halts** |
| `properties_human_review` | skippable_if_complete | skipped |
| `validate_human_review` | skippable_if_complete | skipped |
| `merge_human_approval` | **required** | **halts** |

Hard stops never bypass: `tests_red_after_3x_retry`, `hook_blocked_write`, `merge_conflict`, `git_push_rejected`, `schema_validation_failed`, `test_ratchet_violation`, `lane_tool_sandbox_violation`, `external_dependency_install_proposed`.

## Brief Construction

The brief is the agent's entire context. Get it wrong and the contract breaks. Read `references/brief-builder.md`.

- **RED**: task entry, filtered PROPERTIES, GitNexus context, lane-tools README, stub deps. Exclude: test dir, implementation files, other lanes.
- **GREEN**: same as RED + redacted TestSignal JSON. Exclude: test source, test names, RED output.
- **REFACTOR**: everything. Full SPEC, PROPERTIES, tests, implementation, GitNexus impact.

## Error Recovery

- `ENVIRONMENTAL` → fix in place, same tier, counter not incremented
- `REASONING` → retry ladder: standard → reasoning → reasoning+verbose
- See `references/recovery-modes.md`

## Resume

`datum resume` reads state and continues where it stopped. Completed phases are not re-run. ACT lanes with `in_progress` are re-queued. See `references/recovery-modes.md`.

## Session End

On "session end" or "wrapping up" during a DATUM run, write a handoff to memory:

```
Run ID / Phase / Branch / Lane summary / Decisions / Next action
```

Write to: `~/.claude/projects/<slug>/memory/datum-session-<timestamp>.md`

## Cross-Tool

SKILL.md is tool-agnostic. Subagent primitives are in `assets/config.toml.default` under `[tools]`. Model tiers resolve per-tool via `[models]`. See `references/model-tiers.md`.
