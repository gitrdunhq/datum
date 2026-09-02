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
/datum init        Bootstrap repo: hooks, linter, AGENTS.md, CURRENT_STATE.md, ROADMAP.md. Materialises skills/*.js → .datum/skills/, agents/datum-*.md → .claude/agents/ (committed-safe) and their PreToolUse/PostToolUse hooks → .datum/hooks/ with hook paths rewritten (--refresh re-copies only; --refresh-skills is the old alias).
/datum classify    Auto-classify epic complexity (Patch/Feature/System)
/datum landscape   Generate docs/LANDSCAPE.md from filesystem analysis
/datum mermaid     Generate Mermaid diagrams
/datum dream       Memory consolidation — staleness audit + transcript extraction + pruning
```

## Rule: Agent types and hooks come from `datum init`

`datum init` copies `agents/datum-*.md` into `<repo>/.claude/agents/` and the `pre-tool-use-*`/`post-tool-use-*` hooks they reference into `<repo>/.datum/hooks/`, rewriting `$CLAUDE_PROJECT_DIR/assets/hooks/...` to the absolute materialised path so the hooks fire outside the datum repo. `.datum/config.json` records `hooks_installed` / `agent_types` (both `false` if any step failed). The copy is idempotent and content-compared; `datum init --refresh` forces it after a datum upgrade or a moved checkout. A same-named file in `.claude/agents/` without the datum marker comment is never overwritten. The `.claude/agents/datum-*.md` files are safe to commit; `.datum/` stays gitignored.

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

## Launching `datum-go`

Compute the config fingerprint first and pass it in `args` — the boot agent that reads `.datum/config.json` is replay-cached on `Workflow({resumeFromRunId})`, and the fingerprint in its prompt is what makes an edited config invalidate that cache (#354). Recompute it on every launch, including resumes.

```
FP=$(datum config-fingerprint)
Workflow({ name: "datum-go", args: { yolo: true, configFingerprint: "<FP>" } })
```

Without `configFingerprint` the script logs a warning and a resumed run replays the stale config read.

### Agent types and batched command runners (#368)

Two `.datum/config.json` keys control how the lane pipeline spawns subagents. `datum-go` reads them once at boot and passes them to every child workflow; the standalone phase workflows read them from config themselves.

| Key | Default | Effect |
|---|---|---|
| `agent_types` | `true` | Every mapped `agent()` call passes `agentType`: RED/GREEN/REFACTOR/skeptic/reflect/docs use `agents/datum-{red,green,refactor,skeptic,reflect,docs}.md`, pure JSON/file reads use `datum-reader`, command runners use `datum-cli`. Set to `false` for a runtime without `agentType` support (the OpenAI-compatible runtime) — no call then carries one. |
| `hooks_installed` | `false` | Written by `datum init` once the `datum-red/green/refactor` PreToolUse hooks (lane-file-guard, protect-tests) are materialised in the repo. When `agent_types && hooks_installed`, the per-stage ownership check and the cross-run completion read become plain commands inside the batched `datum-cli` calls, evaluated by the script; otherwise the standalone LLM checks run as before. |

The mapping lives in one table, `AGENT_TYPE_TABLE` in `skills/src/shared/agent-types.ts` (`stageOpts(stage, opts)` at every call site). A vitest drift guard requires an `agents/<name>.md` for every entry.

Consecutive command runners with no LLM judgement between them run as **one** `datum-cli` call whose script lists the commands in order and prints one JSON array of per-step `exit_code`/`stdout`/`stderr` (fail-fast on the first non-tolerant non-zero exit; step lists in `skills/src/shared/lane-steps.ts`). Per lane on the happy path that is 3 calls (`lane-intake`, `post-red`, `post-green`; plus `scope-contract` for pytest lanes) with hooks installed, 5–6 without. Setup, merge (which now also writes the per-lane completion markers and the epic-scoped `datum lane-state` entries — skipped when the merge step failed) and the act-start bootstrap are one call each. The scripts need `jq` and `bash` on the PATH, same as the lane-state markers already did.

Because a custom agent definition replaces the default subagent system prompt and tool set but the CLAUDE.md hierarchy still loads, keep the consumer repo's CLAUDE.md lean; the `datum-cli` runner is `tools: Bash`, `maxTurns: 3`, so every batched script is written to run in a single Bash invocation.

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
1. **RED** — write failing tests (`datum-red`, sonnet); count gate + placeholder scan + scope read run as one batched `datum-cli` call
2. **REFLECT** — score test quality 0-10 (haiku), gate at <4
3. **GREEN** — make tests pass (sonnet, escalates to opus on retry)
4. **SKEPTIC** — adversarial verification panel (3 lenses: edge/error/contract)
5. **REFACTOR** — optional cleanup if haiku pre-check finds improvements
6. **File ownership** — verify each commit only touches allowed files (`git diff --name-only` evaluated by the script when `agent_types && hooks_installed`, an LLM check otherwise)

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
