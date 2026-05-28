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
/datum classify    Auto-classify epic complexity (Patch/Feature/System)
/datum landscape   Generate docs/LANDSCAPE.md from filesystem analysis
/datum mermaid     Generate Mermaid diagrams — ALWAYS activates on "mermaid", "diagram", "visualize"
/datum dream       Memory consolidation — staleness audit + transcript extraction + pruning
```

## Rule: Determinism

Orchestration is deterministic. State, transitions, routing, gates — all enforced by Python scripts. No improvisation. The LLM works within one phase. It does not decide pipeline structure or skip steps. If you are parsing history to figure out where you are, read the state file.

## Dispatcher

Execute in order before any phase work:

**0. Branch Guard** — If on `main`/`master`, auto-create `datum/epic-{N}` and switch. No exceptions.

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

Epic artifacts always live at `docs/epics/<branch>/`. Never `docs/TICKET.md`.

**2.5. Classify Complexity** — After SPEC.md is detected, run `datum classify`. Routes:

| Tier | Criteria | Pipeline |
|---|---|---|
| Patch | < 50 LOC, ≤ 1 cluster, no new public API | Express (`0x-express.md`) |
| Feature | Standard scope | Standard (full pipeline) |
| System | > 5 clusters, or new subsystem, or multi-package | Extended (units in Plan, all Properties, architect sidecar) |

User can override at `plan_human_approval` gate.

**3. Detect Language** — `datum language-detect`. Maps to `references/04-act-{lang}.md`.

**4. Resolve Tier** — `resolve_tier(phase)` returns `{phase, tier, model}` from config. See `references/model-tiers.md`.

**MANDATORY: Every subagent spawn MUST include an explicit `model:` parameter.** Read `[models.phases]` to get the tier name (e.g., `act_red = "standard"`), then resolve it via `[models]` (e.g., `standard = "claude-sonnet-4-6"`). Map to Agent parameter: `reasoning` → `model: "opus"`, `standard` → `model: "sonnet"`, `fast` → `model: "haiku"`. Never rely on the default model. The config is the authority.

**5. Dispatch Phase** — Load the reference doc, execute it, run the gate.

| Phase | Reference | Gate | Notes |
|---|---|---|---|
| Discovery | `00-discovery.md` | — | |
| Refine | `01-refine.md` | skippable | |
| Plan | `02-plan.md` | **required** | System-tier epics include unit decomposition (step 2.5 in 02-plan.md), grouping tasks into parallelizable units of work. |
| Triage | `02.5-triage.md` | **required** | **ALWAYS runs after Plan.** Non-skippable, even in Express. |
| Deepen | `02.8-deepen.md` | skipped if triage routes to properties | Triage decides: deepen or skip to properties. |
| Properties | `03-properties.md` | skippable | |
| Architect | `03.5-architect.md` | blocks if ADRs missing | |
| Act | `04-act.md` | per-lane retry ladder | |
| Validate | `05-validate.md` | skippable | |
| Review | `06-review.md` | max 3 iterations | |
| PR Comments | `07-pr-comments.md` | — | |
| Closeout | `08-closeout.md` | — | |

**Sequencing rule:** After Plan gate passes, the next phase is ALWAYS Triage. Never skip directly to Properties or Act. Triage evaluates the plan and routes to Deepen or Properties. This is non-negotiable — skipping Triage in epic-1 caused the pipeline to miss evidence gathering.

After each phase: `datum gate <phase> [--yolo]`

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

> Plan gate also checks: `## Assumption Audit` in SPEC.md (fails if missing or has unresolved guesses). Emits warning if Refine generated zero questions in QUESTIONS.md.

Hard stops never bypass: `tests_red_after_3x_retry`, `hook_blocked_write`, `merge_conflict`, `git_push_rejected`, `schema_validation_failed`, `test_ratchet_violation`, `lane_tool_sandbox_violation`, `external_dependency_install_proposed`.

## Brief Construction

The brief is the agent's entire context. Get it wrong and the contract breaks. Read `references/brief-builder.md`.

- **RED**: task entry, filtered PROPERTIES, GitNexus context, lane-tools README, stub deps. Exclude: test dir, implementation files, other lanes.
- **GREEN**: same as RED + redacted TestSignal JSON. Exclude: test source, test names, RED output.
- **REFACTOR**: everything. Full SPEC, PROPERTIES, tests, implementation, GitNexus impact.

## Artifacts

These artifacts are committed to `docs/epics/<branch>/` and archived to `.datum/runs/<RUN_ID>/`:

| Artifact | Phase | Purpose |
|---|---|---|
| `TICKET.md` | Input | Original request |
| `SPEC.md` | Refine | Refined requirements + Assumption Audit + Classification Metadata |
| `QUESTIONS.md` | Refine + Plan | Structured Q&A with [Answer]: tags |
| `TASKS.md` | Plan | Implementation plan (root = execution copy, epic dir = archive) |
| `PROPERTIES.md` | Properties | 11-category invariant set |
| `LANDSCAPE.md` | Discovery | Codebase architecture scaffold (project-level, not per-epic) |

## Error Recovery

- `ENVIRONMENTAL` → fix in place, same tier, counter not incremented
- `REASONING` → retry ladder: standard → reasoning → reasoning+verbose
- See `references/recovery-modes.md`

**Self-healing:** On any unexpected error (script crash, missing asset, schema failure on DATUM-generated artifacts), run `datum bugfile <module> "<description>" --trace "<traceback>"` or call `datum.report_bug.report_bug(module, error, context)` from Python. Auto-files a deduplicated GitHub issue with `datum-bug` label. See `AGENTS.md` for the full policy.

## Resume

`datum resume` reads state and continues where it stopped. Completed phases are not re-run. ACT lanes with `in_progress` are re-queued. See `references/recovery-modes.md`.

## Session End

On "session end" or "wrapping up" during a DATUM run, write a handoff to memory:

```
Run ID / Phase / Branch / Lane summary / Decisions / Next action
```

Write to: `~/.claude/projects/<slug>/memory/datum-session-<timestamp>.md`

## Mermaid Diagrams

**Trigger:** Always activates on "mermaid", "diagram", "visualize", "draw the flow", "sequence diagram", "architecture diagram", or `/datum mermaid`.

Built-in diagram and design-doc capability. References and templates are part of the datum package:

| Resource | Use for |
|----------|---------|
| `references/mermaid-diagram-guide.md` | Syntax reference for all diagram types |
| `references/sequence-diagrams.md` | Sequence diagram patterns |
| `references/activity-diagrams.md` | Activity/flowchart patterns |
| `references/architecture-diagrams.md` | C4 and architecture patterns |
| `references/deployment-diagrams.md` | Infrastructure diagrams |
| `references/diagram-legibility.md` | High-contrast styling rules |
| `references/unicode-symbols.md` | Semantic unicode for diagram labels |
| `references/troubleshooting.md` | Mermaid syntax error fixes |
| `references/resilient-workflow.md` | Validate-before-embed workflow |

**Templates:** `templates/system-design-template.md`, `templates/architecture-design-template.md`, `templates/api-design-template.md`, `templates/feature-design-template.md`, `templates/database-design-template.md`

**Scripts:** `scripts/resilient_diagram.py` (validate), `scripts/mermaid_to_image.py` (render PNG), `scripts/extract_mermaid.py` (extract from markdown)

**Rules:**
1. NEVER embed a diagram without validating it first via `datum mermaid validate`
2. ALWAYS use high-contrast styling and unicode semantic symbols
3. PREFER design templates from `templates/` when creating design documents

## Cross-Tool

SKILL.md is tool-agnostic. Subagent primitives are in `assets/config.toml.default` under `[tools]`. Model tiers resolve per-tool via `[models]`. See `references/model-tiers.md`.
