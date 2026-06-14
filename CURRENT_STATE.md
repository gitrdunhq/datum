# datum — Current State

**Branch:** `main` | **Last updated:** 2026-06-14 | **Tests:** 1260 passing

---

## Shipped

### Pipeline Infrastructure Session (2026-06-14, run 20260614-132742)

Full end-to-end datum pipeline delivered as compiled TypeScript workflows.

- **datum-route**: classifies specs into pipeline routes (feature/hotfix/patch/epic) with model-agnostic tier selection (`shared/models.ts`)
- **datum-awake**: codebase distillation → preamble injection into all downstream agents
- **datum-go**: orchestrator that chains all 7 workflows end-to-end (route → awake → refine → plan → properties → act → closeout)
- **Full TS pipeline**: refine, plan, properties, validate, review, closeout all ship as compiled JS with esbuild
- **parseAgentJson resilient parsing**: handles code fences, partial JSON, and phantom phases gracefully
- **Pipeline hardening**: verify gate, file ownership tracking, `gate --approve`, yolo mode, SKILL.md trimming
- **wave_builder validation**: cycle detection and structural validation before act dispatch
- **TICKET template**: headroom integration + append protocol for new ticket generation
- **Closeout self-archiving**: root artifacts (TASKS.md, lane-plan.json, tasks.json) auto-archived to epic dir on closeout
- **Review pass**: 23 findings documented in `docs/epics/main/REVIEW-REPORT.md` (7 high/critical)

### Wave Builder Validation + TS Pipeline (merged 2026-06-13, PR #139)

TypeScript workflow pipeline, consolidated agents, prompt engineering, wave builder cycle detection.

- TypeScript source in `skills/src/` with esbuild transpilation to self-contained JS
- 14 prompt templates as markdown files with `{{placeholder}}` syntax
- Consolidated agents: ~7 per lane (was ~14). Evaluators stay independent.
- REFLECT schema reorder (reasoning before score), SKEPTIC severity enum
- Schema-enforced verification with explicit RED/GREEN logic
- Triage upgraded from haiku to sonnet for root cause analysis
- Per-agent token breakdown in dashboard
- Dedicated git agent with haiku → sonnet escalation
- DAG scheduler with deadlock fix, parallel verify/reflect
- Dream report: 15 fixes across codebase

### Prior Sessions (Epics 1–23, PRs #25–#56)

23 epics shipped. Local LLM pipeline (MLX Gemma/Qwen3), self-healing, semantic memory, TUI dashboard, full installer, closeout command.

---

## What's Next

### Unimplemented: Fail-Fast Deterministic Validation

**Epic:** `fail-fast-validation` (run 20260614-141951) — planning complete, act phase did not run.

The full spec and task plan exist at `docs/epics/datum/fail-fast-validation/`. All 3 tasks are queued and ready for the act phase:

- **task-1**: `runRuffCheck` helper in `datum-tdd-act-lane.ts` — ~35 LOC
- **task-2**: `runMypyCheck` helper in `datum-tdd-act-lane.ts` — ~30 LOC
- **task-3**: Wire ruff → mypy → pytest fail-fast sequence into GREEN phase with retry passback — ~60 LOC

Review identified CORR-010 (critical): the implementation is absent. Run `datum act` to execute the plan.

### Open Review Findings (from fail-fast-validation REVIEW-REPORT.md, 10 high/critical)

**Security:**
- SEC-001 (high): `DATUM_PROJECT_DIR` env var used unvalidated in `os.chdir()` — path traversal (`cli.py:40`)
- SEC-002 (medium): Branch name interpolated unvalidated into filesystem path pattern — path traversal (`cli.py:205`)
- SEC-003 (medium): TOCTOU race in `_install_workflows()` between symlink unlink and recreation (`cli.py:144`)

**Correctness:**
- CORR-001 (critical): Kotlin repos detected as Java — `build.gradle.kts` in java markers, no Kotlin guard (`detect.py:37`)
- CORR-002 (high): `lang` loop variable shadows outer `lang` in `_detect_language` os.walk fallback (`detect.py:72`)
- CORR-003 (high): uv-vs-pip fallback condition inverted — `pyproject.toml` without `uv.lock` gets `uv run pytest` (`detect.py:153`)
- CORR-004 (high): `json.loads(config_path.read_text())` unguarded — malformed config.json crashes `datum init` (`cli.py:185`)
- CORR-005 (high): `link.unlink()` raises `IsADirectoryError` if a directory named like a workflow file exists (`cli.py:140`)
- CORR-006 (high): No null-guard on `epicBranch` before path interpolation in `datum-go.ts` (`datum-go.ts:106`)
- CORR-010 (critical): Primary deliverable absent — ruff+mypy gate not implemented in `datum-tdd-act-lane.ts`

**Performance:**
- PERF-001 (high): O(n×m) dependency filtering — `Array.includes()` on `priorFailures` (`datum-tdd-act-lane.ts:447`)
- PERF-002 (high): O(n×m) intra-batch dependency check — `Array.includes()` on `batchLaneIds` (`datum-tdd-act-lane.ts:457`)

### Open Bugs (datum-bug issues: #140–#153)

Pipeline reliability — known TDD act workflow failure modes:

- #153: `green_blindness_violation` fires with no pytest
- #152: RED verify gate doesn't distinguish test types
- #151: Skeleton ACs don't match test contracts
- #150: Dependency gate triggered despite no real dependency
- #149: RED test assertion not failing as expected
- #145: Workflow resume drops state
- #144: `classify` fails with SPEC.md
- #143: Gate plan always returns `needs_human`
- #142: Root worktree creation
- #141: Uses `datum-reader` agent type incorrectly
- #140: Forwards raw freetext args

### Features

- GitHub sub-issues: Replace local task IDs with real GH issues (planned, not yet implemented — see `docs/epics/datum/gh-issues-as-source-of-truth/`)
- #134: 3-round adversarial review pipeline
- Headless orchestrator for datum-local variant

---

## In Flight

No active feature branches. `main` is clean. `fail-fast-validation` epic is fully planned and ready to act.

---

## Backlog

- PERF-003 (medium): File ownership check nested `.some()` with `.endsWith()` — convert to Set (`datum-tdd-act-lane.ts:75`)
- PERF-004 (low): Array `.slice()` allocation in batch loop — use index pairs (`datum-go.ts:131`)
- CORR-007 (medium): `_detect_ts_test_framework` uses raw substring match on `package.json` text — parse as JSON (`detect.py:108`)
- CORR-008 (medium): `_detect_python_test_framework` always returns `pytest` — no unittest detection path (`detect.py:96`)
- CORR-009 (medium): `datum-go.ts` calls config-reading agent unconditionally — missing `!a.testCommand` guard (`datum-go.ts:93`)
- SEC-004 (low): Shell-quoting defect in `_detect_test_command` fallback echo string (`detect.py:158`)
- #132: Act agent scope violations
- #131: SourceKit false positives on subpackage tests
- #130: Wrong test framework detection
- #128: Package.swift target membership context
- Bedrock flex tier for overnight runs

---

## Architecture

- CLI wrapper at `~/.local/bin/datum`, all docs say `datum <command>`
- TypeScript source → `esbuild --bundle` → self-contained JS workflow scripts in `skills/`
- Prompt templates: markdown files in `skills/src/prompts/` with `{{placeholders}}`, imported at build time
- Pipeline route: `datum-route` → `datum-awake` → `datum-refine` → `datum-plan` → `datum-properties` → `datum-tdd-act` → `datum-closeout`
- Model tiers: haiku (evaluators), sonnet (writers), sonnet → opus (GREEN retry) — configured in `shared/models.ts`
- Dashboard: Python server on port 10001 with per-agent token breakdown
- File ownership hook: PreToolUse, count mode (logs violations, doesn't block yet)
- Closeout: auto-archives TASKS.md, lane-plan.json, tasks.json, SPEC.md, TICKET.md to `docs/epics/<branch>/`
