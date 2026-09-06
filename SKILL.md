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

Outside the pipeline, `datum-awake` (`Workflow({ scriptPath: "<skills_dir>/datum-awake.js" })`) rescans the repo and regenerates the agent preamble; it is not dispatched by `datum-go`.

## Launching `datum-go`

**Always launch by `scriptPath`, never by `name`.** `Workflow({ name: "datum-go" })` resolves the copy registered in `~/.claude/workflows/`, and the harness can hold that copy for the whole session — a run launched right after `datum init --refresh` still executed the previous bundle (its persisted script had none of the new code while `.datum/skills/datum-go.js` had all of it). Sub-workflows are loaded by `scriptPath` from `.datum/skills/`, so they never drift; the top-level launch must do the same. `datum init` (and `--refresh`) prints the exact line for this repo — `<skills_dir>` is the `skills_dir` value in `.datum/config.json` (`<repo>/.datum/skills` in consumer repos).

Compute the inputs fingerprint first and pass it in `args`. `Workflow({resumeFromRunId})` replays every agent call whose prompt is unchanged — the config read, every deterministic batch that reads an epic doc, and every gate. The fingerprint (`.datum/config.json`, `~/.datum/config.json`, every `*.md`/`*.json` in the current epic dir, `.datum/pipeline-state.json`) is stamped into every batch prompt, so a human edit between runs — an answered QUESTIONS.md, a fixed SPEC.md — is a cache miss and an unchanged input still hits (#354). **Recompute it on every launch, resumes included**; a resume with the old value replays the stale gate verdict.

```
FP=$(datum config-fingerprint)
Workflow({ scriptPath: "<skills_dir>/datum-go.js", args: { yolo: true, configFingerprint: "<FP>" } })
```

Without `configFingerprint` the script logs a warning and a resumed run replays every stale read.

### Agent types and batched command runners (#368)

Two `.datum/config.json` keys control how the lane pipeline spawns subagents. `datum-go` reads them once at boot and passes them to every child workflow; the standalone phase workflows read them from config themselves.

| Key | Default | Effect |
|---|---|---|
| `agent_types` | `true` | Every mapped `agent()` call passes `agentType`: RED/GREEN/REFACTOR/skeptic/reflect/docs use `agents/datum-{red,green,refactor,skeptic,reflect,docs}.md`, pure JSON/file reads use `datum-reader`, command runners use `datum-cli`. Set to `false` for a runtime without `agentType` support (the OpenAI-compatible runtime) — no call then carries one. |
| `review_max_iterations` | `3` | Distinct blocked REVIEW-REPORT.md versions the review gate allows before it hard-stops for an architectural review. Raise it when a loop is worth another pass (some iterations are datum-driven, e.g. a reviewer restating a finding). The gate message echoes `iteration N/M`. |
| `main_branch` | detected | The base branch Validate syncs the epic against. Unset: `origin/HEAD`, else `origin/main`, else `origin/master`, else `main`. A repo with no `origin` remote skips the sync by name (`main sync skipped: no origin remote`) and Validate proceeds; a remote whose fetch fails is still `main_sync_failed`. |
| `worktree_link_dirs` | `["node_modules", ".venv"]` | Lane worktrees get their own dependencies at setup: with a `pnpm-lock.yaml` and `pnpm` on PATH, `pnpm install --frozen-lockfile --prefer-offline` runs in each lane (hardlinked from pnpm's global store — seconds, isolated per lane); with a `uv.lock` and `uv`, `uv sync --frozen`. Only what those did not produce is symlinked from the main checkout (this list). A `git worktree add` checkout carries none, and a suite that exits 1 for want of `vitest`/`pytest` is `test_env_missing`, never a red suite. An install failure is `deps_install_failed` on stderr and falls back to the symlink. |
| `hooks_installed` | `false` | Written by `datum init` once the `datum-red/green/refactor` PreToolUse hooks (lane-file-guard, protect-tests) are materialised in the repo. When `agent_types && hooks_installed`, the per-stage ownership check and the cross-run completion read become plain commands inside the batched `datum-cli` calls, evaluated by the script; otherwise the standalone LLM checks run as before. |

The mapping lives in one table, `AGENT_TYPE_TABLE` in `skills/src/shared/agent-types.ts` (`stageOpts(stage, opts)` at every call site). A vitest drift guard requires an `agents/<name>.md` for every entry.

Consecutive command runners with no LLM judgement between them run as **one** `datum-cli` call whose script lists the commands in order and prints one JSON array of per-step `exit_code`/`stdout`/`stderr` (fail-fast on the first non-tolerant non-zero exit; step lists in `skills/src/shared/lane-steps.ts`). Per lane on the happy path that is 3 calls (`lane-intake`, `post-red`, `post-green`; plus `scope-contract` for pytest lanes) with hooks installed, 5–6 without. Setup, merge (which now also writes the per-lane completion markers and the epic-scoped `datum lane-state` entries — skipped when the merge step failed) and the act-start bootstrap are one call each. The scripts need `jq` and `bash` on the PATH, same as the lane-state markers already did.

The lane batches reset datum's own scratch worktrees (`git reset --hard`, `git clean -fd` under `.datum/worktrees/`). A host permission classifier can refuse those for subagents; the runner then answers in prose, the batch is re-sent once to a fresh runner, and a second refusal fails the lane as `runner_permission_denied` with the excerpt. That is an operator decision, not a datum bug — see "Permissions" below. datum will not wrap those commands in its own CLI to get past the classifier, and it will not write the rules for you.

Every batch script is delivered through a quoted heredoc into a temp file, hash-checked with `git hash-object` against the sha the workflow computed, and run only on a match; a runner that re-typed the script gets one retry with a fresh runner and a second mismatch fails by name (`batch_script_corrupt`). Every batch also starts with a `cd` to the repo root datum-go measured at boot, so the shell's current directory (a second worktree, a subdirectory) cannot redirect relative paths; a root that no longer exists is `batch_root_missing` and nothing in the batch runs.

## Permissions

`datum permissions-snippet` prints the JSON to merge into the consumer repo's `.claude/settings.local.json` (`autoMode.allow`, keep `"$defaults"` first). datum prints and documents these rules; it never writes them, because a pipeline installing the rules that permit its own `git reset --hard` would be granting itself permissions — that call belongs to the repo's operator. The two rules:

1. Running any step of the local datum pipeline (`Workflow` by scriptPath, including act, merge and closeout) without a per-run confirmation, as long as it only touches local branches/worktrees and files under `.datum/`, `docs/epics/` and the working tree, and never itself runs `git push`, `git push --force`, `gh pr create` or `gh pr merge`.
2. `git reset --hard`, `git clean -fd`, `git checkout`, `git status` and `datum ...` on a datum scratch lane worktree (any path containing `/.datum/worktrees/` under the repo root), whether as `git -C <path>`, after `cd <path>`, or inside a batch script (they start with `__bo=$(mktemp)` and print per-step exit codes as JSON). These worktrees are disposable per-lane checkouts; resetting them touches no user work or history.

Observed in dogfooding (elonchesd): plain `permissions.allow` prefix rules cannot match the batch-script shape, so these classifier-prompt rules are the lever; a repo-local rule alone was still refused about two runs in three, and adding the same rules at user level with `/auto-mode-setup` helped; the settings file must exist before the session starts (or run `/hooks`) for the watcher to load it. Pushes and PR creation stay gated.

Because a custom agent definition replaces the default subagent system prompt and tool set but the CLAUDE.md hierarchy still loads, keep the consumer repo's CLAUDE.md lean; the `datum-cli` runner is `tools: Bash`, `maxTurns: 3`, so every batched script is written to run in a single Bash invocation.

## Act Phase — TDD Workflow Pipeline

Act is handled by the `datum-tdd-act` TypeScript workflow (`skills/src/datum-tdd-act.ts`).

**Invocation** (by `scriptPath`, same reason as `datum-go` above):
```
Workflow({ scriptPath: "<skills_dir>/datum-tdd-act.js", args: "yolo" })
```
Yolo mode auto-detects the current branch and generates a run ID. Or pass explicit args:
```
Workflow({ scriptPath: "<skills_dir>/datum-tdd-act.js", args: { epicBranch: "datum/epic-17", runId: "20260614-010000" } })
```

**Pipeline stages per lane:**
0. **Intake** — one batched `datum-cli` call: `datum lane-spec-export` writes the lane's acceptance criteria, red_note and contract summary to `<worktree>/.datum/lane-spec.json` (hash-checked against the scheduler digest) and returns only its path/bytes/blob sha/ac_count. No runner turn ever carries the criteria text (an echo rewrote backticks). Every stage below reads that file and must return a `read_witness` with its blob-sha prefix, or the lane fails as `context_read_unverified`.
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

**Review findings.** `datum gate review` blocks on every high/critical row in `docs/epics/<branch>/REVIEW-REPORT.md` and names the blocking ids and keys. Ids (PERF-001) are reassigned on every review run; the report's Key column is stable (lens, file, normalised description). A reviewer's severity is a calibration, not a verdict: record a reasoned accept per finding with `datum review-accept <ID-or-key> --reason "..."`, which resolves the id against the current report and appends `- ACCEPT <key> (<ID> file:line): <reason>` to `docs/epics/<branch>/REVIEW-RESPONSE.md` next to the report (commit it); `--defer-to <epic-branch>` writes a DEFER line the gate treats the same (carry-forward into the target epic is #450). Accepted keys do not block and are named in the gate's pass message; a line with no reason does not count, and a bare-id accept on a keyed report is named as ignored. A reviewer that restates a finding produces a new key; the gate then matches the recorded decision by its `(<ID> file:line)` note, the same file and line under any lens, and says "matched prior decision <token> (file+line)" or "(file+line+R12)" when both cite a requirement id. A different line is a different finding. An iteration is a distinct blocked report, recorded per epic in `.datum/epics/<slug>/review-iterations.json`; re-checking the same report never counts. After three distinct blocked reports the gate hard-stops for an architectural review, until every blocker is fixed, accepted or deferred.

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
| `PROPERTIES.md` | Properties | 11-category invariant set + `## Integration Invariants` table (drives synthetic `task-INT-<n>` lanes in Plan) |

## Cross-Tool

SKILL.md is tool-agnostic. Model tiers resolve per-tool via `[models]` in config. See `references/model-tiers.md`.
