# datum — Current State

**Branch:** `main` | **Last updated:** 2026-06-14 | **Tests:** 1260 passing

---

## Shipped

### Bug Squash Epic #167 — Planning Complete (2026-06-14, run 20260614-154341)

Epic `bug-squash-167` reached full planning depth: ticket, spec, task decomposition, lane plan, properties, and review are all committed. The act phase has not yet run — 6 tasks remain queued. Implementation is the next step.

**Bugs catalogued (7 total, 4 critical / 3 high):**

| ID | Severity | Bug | Fix Target |
|---|---|---|---|
| #166 | critical | Act phase silently skips lanes when lane-plan.json not found | `skills/src/datum-go.ts` |
| #161 | critical | `make_function_name()` emits hyphens in Python identifiers | `datum/skeleton_creator.py:337` |
| #163 | critical | Lane plan assigns same impl file to multiple lanes | `datum/lane_plan.py:356` |
| #160 | critical | `skeleton_creator.py` overwrites test files across lanes | `datum/skeleton_creator.py:467,556,579` |
| #165 | high | `datum-go` uses relative scriptPath — breaks when CWD != repo root | `skills/src/datum-go.ts` |
| #158/#162 | high | Test-count gate misses `class Test` methods | `skills/src/datum-tdd-act-lane.ts:174` |
| #159 | high | `file_conflict_with` field populated but no dependency edges added | `datum/lane_plan.py:277` |

**Review findings (10 total, 2 critical / 2 high / 4 medium / 1 low):**

- CORR-001 (critical): 5 of 6 RED skeletons absent in `tests/test_ruff_precheck.py` — preflight falsely logged `skeleton_written=True`
- CORR-002 (critical): Same — 5 of 6 RED skeletons absent in `tests/test_mypy_precheck.py`
- ARCH-001/ARCH-002 (high): Traceability comments in both test files use hyphenated names that don't match actual functions
- ARCH-003/ARCH-004/ARCH-005/CORR-003/CORR-004 (medium): `make_function_name()` sanitization gap; `write_text()` no existence check; coupling in plan→skeleton handoff
- CORR-005 (low): Docstring truncated in `tests/test_ruff_precheck.py:9`

### Pipeline Infrastructure Session (2026-06-14, run 20260614-132742)

Full end-to-end datum pipeline delivered as compiled TypeScript workflows.

- **datum-route**: classifies specs into pipeline routes (feature/hotfix/patch/epic) with model-agnostic tier selection (`shared/models.ts`)
- **datum-awake**: codebase distillation → preamble injection into all downstream agents
- **datum-go**: orchestrator that chains all 7 workflows end-to-end (route → awake → refine → plan → properties → act → closeout)
- **Full TS pipeline**: refine, plan, properties, validate, review, closeout all ship as compiled JS with esbuild
- **parseAgentJson resilient parsing**: handles code fences, partial JSON, and phantom phases gracefully
- **Pipeline hardening**: verify gate enforces GREEN before merge; file ownership tracking in PreToolUse hook; `gate --approve` for manual overrides; yolo mode for CI; SKILL.md trimming
- **wave_builder validation**: cycle detection and structural validation before act dispatch
- **TICKET template**: headroom integration + append protocol for new ticket generation
- **Closeout self-archiving**: root artifacts (TASKS.md, lane-plan.json, tasks.json, SPEC.md, TICKET.md, PROPERTIES.md) auto-archived to `docs/epics/<branch>/` on closeout

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

### Priority 1: Run Act Phase for Bug Squash #167 (6 tasks, all queued)

**Epic:** `bug-squash-167` — all planning complete. Run `datum act` to execute.

Lane plan at `docs/epics/datum/bug-squash-167/lane-plan.json`. Topological order: task-1 → task-2 → task-3 → task-4 → task-5 → task-6 (task-6 depends on task-4 and task-5).

**Critical fixes (pipeline produces wrong results):**
- **task-1**: `make_function_name()` in `datum/skeleton_creator.py` — add `.replace('-', '_')` after `slugify()` call. Files: `datum/skeleton_creator.py`, `tests/test_make_function_name.py`
- **task-2**: `build_lane_plan()` in `datum/lane_plan.py` — consume `conflicts` from `build_file_ownership()` and convert to dependency edges. Files: `datum/lane_plan.py`, `tests/test_lane_plan_conflicts.py`
- **task-3**: `skeleton_creator.py` write sites — replace 3x `write_text()` with append-or-create logic. Files: `datum/skeleton_creator.py`, `tests/test_skeleton_append.py`
- **task-4**: Act phase in `datum-go.ts` — add path logging and descriptive error on missing lane plan. Files: `skills/src/datum-go.ts`, `tests/test_act_phase_logging.py`

**High fixes (blocks pipeline progress):**
- **task-5**: Diff grep pattern in `datum-tdd-act-lane.ts` — change `'^+def test_'` to `'^+[[:space:]]*def test_'`. Files: `skills/src/datum-tdd-act-lane.ts`, `tests/test_grep_test_count.py`
- **task-6**: Rebuild generated JS — run `bash scripts/build-workflows.sh`. Files: `skills/datum-go.js`, `skills/datum-tdd-act-lane.js` (depends on task-4 + task-5)

### Priority 2: Implement Fail-Fast Deterministic Validation

**Epic:** `fail-fast-validation` (run 20260614-141951) — planning complete, act phase not yet run.

- **task-1**: `runRuffCheck` helper in `datum-tdd-act-lane.ts` — ~35 LOC
- **task-2**: `runMypyCheck` helper in `datum-tdd-act-lane.ts` — ~30 LOC
- **task-3**: Wire ruff → mypy → pytest fail-fast sequence into GREEN phase with retry passback — ~60 LOC

### Open Review Findings (bug-squash-167)

**Critical:**
- CORR-001: Only 1 of 6 RED skeletons present in `tests/test_ruff_precheck.py` — AC1-AC5 missing
- CORR-002: Only 1 of 6 RED skeletons present in `tests/test_mypy_precheck.py` — AC1-AC5 missing

**High:**
- ARCH-001: Traceability comment in `tests/test_mypy_precheck.py:3` uses hyphenated name that doesn't match actual function
- ARCH-002: Same traceability mismatch in `tests/test_ruff_precheck.py:3`

**Medium:**
- ARCH-003: `skeleton_creator.py:337` — `make_function_name()` no language-aware sanitization after slugify
- ARCH-004: `skeleton_creator.py:467` — `dest.write_text()` no existence check (bug #160 root)
- ARCH-005: `TICKET.md:14` — bug #163 exposes tight coupling between plan output and skeleton consumption
- CORR-003: `tests/test_ruff_precheck.py:3` — traceability comment still contains hyphenated name
- CORR-004: `tests/test_mypy_precheck.py:3` — same

**Low:**
- CORR-005: `tests/test_ruff_precheck.py:9` — docstring truncated, missing `, errors: [] }`

### Open Review Findings (fail-fast-validation)

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

- GitHub sub-issues: Replace local task IDs with real GH issues (planned — `docs/epics/datum/gh-issues-as-source-of-truth/`)
- #134: 3-round adversarial review pipeline
- Headless orchestrator for datum-local variant

---

## In Flight

No active feature branches. `main` is clean. Two epics fully planned and ready to act: `bug-squash-167` (priority) and `fail-fast-validation`.

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
