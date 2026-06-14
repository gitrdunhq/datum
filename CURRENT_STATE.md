# datum — Current State

**Branch:** `main` | **Last updated:** 2026-06-13 | **Tests:** 1260 passing

---

## Shipped

### Wave Builder Validation + TS Pipeline (merged 2026-06-13, PR #139)

TypeScript workflow pipeline, consolidated agents, prompt engineering, wave builder cycle detection.

- TypeScript source in `skills/src/` with esbuild transpilation to self-contained JS
- 14 prompt templates as markdown files with `{{placeholder}}` syntax
- Consolidated agents: ~7 per lane (was ~14). Evaluators stay independent.
- REFLECT schema reorder (reasoning before score), SKEPTIC severity enum
- Schema-enforced verification with explicit RED/GREEN logic
- Triage upgraded from haiku to sonnet for root cause analysis
- Per-agent token breakdown in dashboard
- Dedicated git agent with haiku->sonnet escalation
- DAG scheduler with deadlock fix, parallel verify/reflect
- Dream report: 15 fixes across codebase

### Prior Sessions (Epics 1-23, PRs #25-#56)

23 epics shipped. Local LLM pipeline (MLX Gemma/Qwen3), self-healing, semantic memory, TUI dashboard, full installer, closeout command.

---

## What's Next

### Open Bugs (8 datum-bug issues: #140-#153)

Pipeline reliability — the TDD act workflow has several known failure modes:

- #153: green_blindness_violation fires with no pytest
- #152: RED verify gate doesn't distinguish test types
- #151: Skeleton ACs don't match test contracts
- #150: Dependency gate triggered despite no real dependency
- #149: RED test assertion not failing as expected
- #145: Workflow resume drops state
- #144: classify fails with SPEC.md
- #143: gate plan always returns needs_human
- #142: Root worktree creation
- #141: Uses datum-reader agent type incorrectly
- #140: Forwards raw freetext args

### Features

- #139: Wave builder cycle detection (implementation done, pipeline validation ongoing)
- #134: 3-round adversarial review pipeline
- GitHub sub-issues: Replace local task IDs with real GH issues

---

## In Flight

Clean working tree on main. No active feature branches in progress.

---

## Backlog

- #132: act agent scope violations
- #131: SourceKit false positives on subpackage tests
- #130: wrong test framework detection
- #128: Package.swift target membership context
- Headless orchestrator for datum-local variant
- Bedrock flex tier for overnight runs

---

## Architecture

- CLI wrapper at `~/.local/bin/datum`, all docs say `datum <command>`
- TypeScript source -> `esbuild --bundle` -> self-contained JS workflow scripts
- Prompt templates: markdown files with `{{placeholders}}`, imported at build time
- TDD model tiers: haiku (evaluators), sonnet (writers), sonnet->opus (GREEN retry)
- Dashboard: Python server on port 10001 with per-agent token breakdown
- File ownership hook: PreToolUse, count mode (logs violations, doesn't block yet)
