# datum — Current State

**Branch:** `datum/wave-builder-validation` | **Last updated:** 2026-06-13 | **Tests:** 1260 passing

---

## Shipped

### TypeScript Workflow Pipeline + Agent Consolidation (2026-06-13)

Rewrote the TDD pipeline from hand-written JS to TypeScript source with esbuild transpilation. Research-backed prompt improvements applied across all 8 agent roles.

- TypeScript source in `skills/src/` with shared types, schemas, utils, agents
- 14 prompt templates as markdown files (`skills/src/prompts/*.md`) with `{{placeholder}}` syntax
- `esbuild --bundle` transpiles to self-contained JS (no imports in output)
- `bash scripts/build-workflows.sh` — type check + bundle + verify
- REFLECT schema field reorder (reasoning before score — 10-15% accuracy improvement per J1 paper)
- SKEPTIC severity enum + required evidence fields
- Consolidated agents: RED/GREEN/REFACTOR each write + verify + commit in one call (~14 agents/lane → ~7)
- `STAGE_RESULT_SCHEMA`: { success, tests_pass, committed, commit_sha, test_errors }
- `VERIFY_STAGE_SCHEMA` with schema enforcement (fixes green_blindness false positives)
- Triage upgraded from haiku to sonnet for root cause analysis
- Per-agent token breakdown in dashboard (input/output/cache_read/cache_create)
- File ownership hook (`scripts/hook-file-ownership.sh`) — count mode, logs violations
- CLAUDE.md updated: generated JS files are read-only

### Phase Split + Single Writer (2026-06-13, earlier)

- 1007-line monolith → 6 workflow files via `workflow()` nesting
- Dedicated git agent (`commitStage`) with haiku→sonnet escalation
- `resetWorktree()`, `revertLastCommit()`, `verifyStage()` extracted
- DAG scheduler with `.catch()` deadlock fix
- Null guard on `r.stage` in Triage (#148)
- DAG scheduling + parallel verify/reflect (#146, #147)

### Prior Sessions (Epics 1-23, PRs #25-#41)

23 epics shipped. Local LLM pipeline (MLX Gemma/Qwen3), self-healing, semantic memory, TUI dashboard, full installer.

---

## In Flight

- **`datum/wave-builder-validation`** — TDD pipeline test run on issue #139 (wave_builder cycle detection). Implementation exists, pipeline running against it to validate new prompts + consolidated agents. 3 runs so far, fixing verify schema enforcement.
- **GitHub sub-issues research** — agent exploring GH API for parent/child issue relationships. Goal: `datum plan` creates real GH issues with metadata in invisible HTML comments.
- **Dream analysis** — sonnet agent scanning codebase for dead code, inconsistencies, quick wins.
- **Flex tier research** — completed. Bedrock + `ANTHROPIC_BEDROCK_SERVICE_TIER=flex` is the only path for 50% savings without rearchitecting. No flex on direct Anthropic API.
- 5 commits ahead of main on this branch.

---

## What's Next

### GitHub Sub-Issues (next feature)

Replace local `task-001` IDs with real GitHub issues. `datum plan` creates parent epic issue + child task issues. Metadata lives in invisible HTML comments on issue body. Each lane gets a `#number`, trackable through GitHub's issue graph.

### Pipeline Hardening

- Fix stale test cleanup (worktrees inherit old test files from prior runs)
- Idempotent worktree setup (`datum worktrees setup` should detect/reset dirty worktrees on resume)
- Extended thinking for triage (pending `agent()` API support)

### Audit Items (from opus review)

- E1: Implementation stubs in skeleton_creator.py (reduce opus escalation)
- E4: Fix skeleton template NotImplementedError → assert False

---

## Backlog

- #134: 3-round adversarial review pipeline
- #132: act agent scope violations
- #131: SourceKit false positives on subpackage tests
- #130: wrong test framework detection
- #128: Package.swift target membership context
- Headless orchestrator for datum-local variant
- Bedrock flex tier for overnight runs (~$143/month savings at 3 runs/day)

---

## Architecture

- CLI wrapper at `~/.local/bin/datum`, all docs say `datum <command>`
- TypeScript source → `esbuild --bundle` → self-contained JS workflow scripts
- Prompt templates: markdown files with `{{placeholders}}`, imported at build time
- TDD model tiers: haiku (evaluators), sonnet (writers), sonnet→opus (GREEN retry)
- Consolidated agents: ~7 per lane (was ~14). Evaluators stay independent.
- Dashboard: Python server on port 10001 with per-agent token breakdown
- File ownership hook: PreToolUse, count mode (logs violations, doesn't block yet)
