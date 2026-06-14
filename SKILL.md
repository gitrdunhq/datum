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
/datum classify    Auto-classify epic complexity (Patch/Feature/System)
/datum landscape   Generate docs/LANDSCAPE.md from filesystem analysis
/datum mermaid     Generate Mermaid diagrams
/datum dream       Memory consolidation — staleness audit + transcript extraction + pruning
```

## Rule: Determinism

Orchestration is deterministic. State, transitions, routing, gates — all enforced by Python scripts and TypeScript workflow pipelines. No improvisation. The LLM works within one phase. It does not decide pipeline structure or skip steps.

## Dispatcher

Execute in order before any phase work:

**0. Branch Guard** — If on `main`/`master`, auto-create a feature branch and switch. Slugify the brief/TICKET title into `datum/<slug>`.

**0.5. Self-check** — `datum doctor`. If it fails, halt.

**1. Load Config** — `.datum/config.toml`, falling back to `assets/config.toml.default`.

**2. Read State** — `datum status --json`. If no state, detect entry:

| Artifact | Entry |
|---|---|
| `docs/epics/$BRANCH/TICKET.md` | Refine |
| `docs/epics/$BRANCH/SPEC.md` (no TASKS.md) | Plan |
| `TASKS.md` + PROPERTIES.md | Act |
| PR URL | PR Comments |
| Nothing | Offer `datum init` |

Epic artifacts always live at `docs/epics/<branch>/`.

**3. Dispatch Phase** — Each phase is a TypeScript workflow. `datum-go` chains them all.

| Phase | Workflow | Gate |
|---|---|---|
| Refine | `datum-refine` | skippable |
| Plan | `datum-plan` (includes triage + deepen) | **required** |
| Properties | `datum-properties` | skippable |
| Act | `datum-tdd-act` | per-lane gates |
| Validate | `datum-validate` | skippable |
| Review | `datum-review` | max 3 iterations |
| Closeout | `datum-closeout` | — |

After each phase: `datum gate <phase> [--approve]`

## Act Phase — TDD Workflow Pipeline

Act is handled by the `datum-tdd-act` TypeScript workflow (`skills/src/datum-tdd-act.ts`).

**Invocation:**
```
Workflow({ name: "datum-tdd-act", args: "yolo" })
```
Yolo mode auto-detects the current branch and generates a run ID. Or pass explicit args:
```
Workflow({ name: "datum-tdd-act", args: { epicBranch: "datum/epic-17", runId: "20260614-010000" } })
```

**Pipeline stages per lane:**
1. **RED** — write failing tests (sonnet), structural assertion check (haiku)
2. **REFLECT** — score test quality 0-10 (haiku), gate at <4
3. **GREEN** — make tests pass (sonnet, escalates to opus on retry)
4. **SKEPTIC** — adversarial verification panel (3 lenses: edge/error/contract)
5. **REFACTOR** — optional cleanup if haiku pre-check finds improvements
6. **File ownership** — verify each commit only touches allowed files

**Source:** `skills/src/` (TypeScript) -> `skills/*.js` (generated via `bash scripts/build-workflows.sh`)

**Prompt templates:** `skills/src/prompts/*.md` with `{{placeholder}}` syntax

**Model tiers:** haiku (evaluators), sonnet (writers), sonnet->opus (GREEN retry)

## Gates

| Gate | Policy | --approve? |
|---|---|---|
| `refine_human_review` | skippable | skipped |
| `plan_human_approval` | **required** | **halts** |
| `triage_human_approval` | **required** | **halts** |
| `properties_human_review` | skippable | skipped |
| `validate_human_review` | skippable | skipped |
| `merge_human_approval` | **required** | **halts** |

Hard stops never bypass: `tests_red_after_3x_retry`, `hook_blocked_write`, `merge_conflict`, `schema_validation_failed`, `file_ownership_violation`.

## Error Recovery

- `ENVIRONMENTAL` -> fix in place, same tier, counter not incremented
- `REASONING` -> retry ladder: standard -> reasoning
- Self-healing: `datum bugfile <module> "<description>" --trace "<traceback>"`

## Artifacts

| Artifact | Phase | Purpose |
|---|---|---|
| `TICKET.md` | Input | Original request |
| `SPEC.md` | Refine | Refined requirements |
| `TASKS.md` | Plan | Implementation plan |
| `.datum/lane-plan.json` | Plan | Machine-readable task DAG for Act |
| `PROPERTIES.md` | Properties | 11-category invariant set |

## Cross-Tool

SKILL.md is tool-agnostic. Model tiers resolve per-tool via `[models]` in config. See `references/model-tiers.md`.
