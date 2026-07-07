# Changelog

All notable changes to DATUM are documented here.

## [Bug Squash Round 2] — 2026-07-07 (run 20260707-093851)

### Fixed

Epic targeted ten self-filed bugs from epic #282 (issues #265, #269, #270, #213, #301,
#302, #303, #304, #307, #309 — see `docs/epics/datum/bug-squash-round-2/SPEC.md`).
21 commits merged to `main` at `7be6c6f082cd`, 55 files touched, +2556/-203 LOC.
During self-hosted execution the pipeline encountered its own bugs mid-run and fixed
them inline rather than only landing the ten original targets:

- **`fix(pipeline)`**: replaced ambiguous `<branch>` placeholder with real shell
  substitution (`7f3f486`)
- **`fix(pipeline)`**: required programmatic JSON construction for large file-content
  embeds, avoiding string-interpolation breakage (`c271035`)
- **`fix(pipeline)`**: resolved safety-classifier blockers in `datum go` run (`0a0b4fd`)
- **`fix(pipeline)`**: seed `resolvedBranch`/`runId` from prior pipeline-state on resume
  (`b8e0599`)
- **`fix(build)`**: added `@types/node`, excluded `.test.ts` from workflow entry points
  (`03da9ec`)
- **`fix(worktree)`**: reuse existing lane branch on worktree-add collision (`f68a656`)
- **`fix(worktree)`**: deregister stale worktree when lane branch is checked out
  elsewhere (`cb282f9`)
- **`fix(lane)`**: path-boundary-aware `verifyFileOwnership`, exported from
  `shared/utils` (`35a7bd6`)
- **`docs`**: recorded CLI-only mandate and pipeline overview updates for #265/#270/#213
  (`c366d03`)

Four review passes ran during the epic, converging from 9 findings → 7 → 6 → 4
(`2d5f424`, `9ce97a4`, `30689a7`, `7be6c6f`).

### Known Gaps

- This run's closeout telemetry (`tasks`, `solutions`, `brief_defects`, `token_metrics`
  in `closeout-data.json`) was empty/zero, so per-task completion status against the
  original R1–R10 requirements could not be confirmed. Treat R1–R10 as **unverified**
  pending a follow-up check (see `follow-ups.json`).
- GitNexus impact-detail collection was unavailable this run (MCP not live), so no
  symbol-level blast-radius data exists for this merge (base `badb2a9b` → merge
  `7be6c6f0`).

---

## [Bug Squash #167 Act Phase — Partial] — 2026-06-14 (run 20260614-161954)

### Fixed

Act phase executed against `bug-squash-167` plan. 2 of 6 tasks completed, 1 partial. Review returned 0 findings.

**task-1 — `make_function_name()` hyphens in identifiers (COMPLETED)**
- `datum/skeleton_creator.py`: Added `.replace('-', '_')` after `slugify()` call in `make_function_name()`
- Fixes: generated Python/Swift test function names are now valid identifiers for any AC text containing hyphens
- Commit: `43be12e`

**task-4 — Act phase path resolution and error logging (COMPLETED)**
- `skills/src/datum-go.ts`: All `scriptPath` values converted from bare relative strings to `skillPath()`-resolved absolute paths
- Config read early (before phase loop) so `skillPath()` is available across all phases
- Arg parsing made resilient: freetext and issue-number strings now accepted (no longer throws on non-JSON input)
- Debug log added at Act phase entry: `shouldRun act=`, `startIdx=`, `haltedAt=`, `activePhases=`
- `skills/datum-go.js`: Rebuilt from updated TS source
- Fixes: `datum go` no longer produces `ENOENT` errors when CWD != repo root (#165)
- Commit: `43be12e`

**task-6 — JS rebuild (PARTIAL)**
- `skills/datum-go.js`: Updated with task-4 scriptPath fixes
- `skills/datum-tdd-act-lane.js`: Rebuilt with `DEFAULT_CONFIG.skills_dir` addition only — task-5 grep fix not included
- Commit: `43be12e`

**Bonus: Remove phantom phases from datum-tdd-act**
- `skills/src/datum-tdd-act.ts` / `skills/datum-tdd-act.js`: Removed duplicate phase-display entries
- Child workflows (datum-tdd-act-setup, datum-tdd-act-lane, datum-tdd-act-merge, etc.) own their own phase display — orchestrator no longer echoes phantom phases
- Commit: `a34f8af`

### Not Completed

- **task-2**: `datum/lane_plan.py:356` — file-conflict dependency edges not wired (`_` still discards conflicts)
- **task-3**: `datum/skeleton_creator.py:467,556,579` — `Path.write_text()` still overwrites; append-or-create not implemented
- **task-5**: `datum-tdd-act-lane.ts:174` — grep pattern `'^+def test_'` unchanged; class-based test methods undercounted

---

## [Bug Squash #167 — Closeout] — 2026-06-14 (run 20260614-154341)

### Closed Out (planning complete, act phase queued)

Epic `bug-squash-167` closed out with full planning artifacts committed. Act phase not executed — 6 tasks remain queued and ready to run with `datum act`.

**Artifacts committed to `docs/epics/datum/bug-squash-167/`:**
- `TICKET.md` — 7 bugs (4 critical, 3 high) structured for act dispatch
- `SPEC.md` — requirements with per-bug acceptance criteria and symbol-level call sites
- `TASKS.md` / `tasks.json` — 6-task plan (7 bugs collapsed into 6 tasks, task-6 is JS rebuild)
- `lane-plan.json` — 6 lanes, topological order with dependency edges (task-6 depends on task-4 + task-5)
- `PROPERTIES.md` — safety and liveness properties for each fix
- `REVIEW-REPORT.md` — 10 findings (2 critical, 2 high, 4 medium, 1 low)
- `RETRO.md` — metrics, observations, defect table, follow-ups
- `routing.json` — pipeline route classification

**Follow-ups filed:**
- Run act phase: 6 tasks queued at `docs/epics/datum/bug-squash-167/lane-plan.json`
- Post-skeleton write verification (trust-without-verify defect in preflight)
- Fix traceability comments in `tests/test_ruff_precheck.py:3` and `tests/test_mypy_precheck.py:3`
- Complete truncated docstring at `tests/test_ruff_precheck.py:9`
- Fix CORR-001/CORR-002: restore 5 missing RED skeletons in ruff and mypy test files

---

## [Bug Squash #167] — 2026-06-14 (run 20260614-145327)

### Planned (act phase not executed)

**Epic:** `bug-squash-167` — ticket and review complete. 7 pipeline friction bugs catalogued and reviewed. Implementation not yet run.

- **TICKET.md**: 7 bugs (4 critical, 3 high) filed as a structured fix epic. Root causes span skeleton generation, lane orchestration, test-count gate, and path resolution.
- **REVIEW-REPORT.md**: 10 findings (2 critical, 2 high, 4 medium, 1 low). Key finding: `skeleton_written=True` logged for all 6 ACs in preflight packets but only 1 RED skeleton committed to each of `tests/test_ruff_precheck.py` and `tests/test_mypy_precheck.py`.

### Review Findings (10 total)

| ID | Severity | File | Description |
|---|---|---|---|
| ARCH-001 | high | tests/test_mypy_precheck.py:3 | Traceability comment uses hyphenated name; actual function uses underscores |
| ARCH-002 | high | tests/test_ruff_precheck.py:3 | Same traceability mismatch as ARCH-001 |
| ARCH-003 | medium | datum/skeleton_creator.py:337 | make_function_name() no language-aware sanitization after slugify() |
| ARCH-004 | medium | datum/skeleton_creator.py:467 | write_text() with no existence check — overwrites on multi-lane (bug #160 root) |
| ARCH-005 | medium | docs/epics/datum/bug-squash-167/TICKET.md:14 | bug #163 exposes tight coupling between plan output and skeleton consumption |
| CORR-001 | critical | tests/test_ruff_precheck.py:6 | Only 1 of 6 RED skeletons present — AC1-AC5 absent despite preflight logging skeleton_written=True |
| CORR-002 | critical | tests/test_mypy_precheck.py:6 | Same as CORR-001 — AC1-AC5 absent from mypy test file |
| CORR-003 | medium | tests/test_ruff_precheck.py:3 | Traceability comment still references pre-fix hyphenated function name |
| CORR-004 | medium | tests/test_mypy_precheck.py:3 | Same hyphenated traceability comment as CORR-003 |
| CORR-005 | low | tests/test_ruff_precheck.py:9 | Docstring truncated — missing `, errors: [] }` from full AC text |

---

## [Fail-Fast Validation Epic] — 2026-06-14 (run 20260614-141951)

### Planned (act phase not executed)

**Epic:** `fail-fast-validation` — full spec, task plan, properties, and review completed. Implementation not yet run.

- **SPEC.md**: deterministic ruff + mypy pre-check gate inside `runLane`, inserted after GREEN writes and before pytest. Fail-fast ordering: ruff → mypy → pytest. Structured error passback into GREEN retry with model escalation to `deep`.
- **TASKS.md / tasks.json / lane-plan.json**: 3-task plan with dependency graph (task-1 → task-3, task-2 → task-3). Estimated ~125 LOC across `skills/src/datum-tdd-act-lane.ts` and 3 new test files.
- **PROPERTIES.md**: 12 safety properties, 6 liveness properties, 4 ordering properties, 2 observability properties.
- **REVIEW-REPORT.md**: 18 findings (2 critical, 8 high). CORR-010 (critical): primary deliverable absent — implementation must be completed in next session.

### Review Findings Filed (18 total)

Key issues from `docs/epics/datum/fail-fast-validation/REVIEW-REPORT.md`:

- CORR-010 (critical): ruff+mypy gate absent from `datum-tdd-act-lane.ts` — primary deliverable not implemented
- CORR-001 (critical): Kotlin language detection broken — `build.gradle.kts` in java markers with no Kotlin guard
- SEC-001 (high): `DATUM_PROJECT_DIR` path traversal via unvalidated `os.chdir()`
- PERF-001/PERF-002 (high): O(n×m) dependency filtering via `Array.includes()` — convert to Set
- CORR-003/CORR-004/CORR-005/CORR-006 (high): detect.py and cli.py correctness defects

---

## [Pipeline Infrastructure Session] — 2026-06-14 (run 20260614-132742)

### Added

- **`datum-route` workflow**: classifies specs into pipeline routes (feature/hotfix/patch/epic) using a model-agnostic tier system. Route drives model selection for every downstream phase.
- **`datum-awake` workflow**: scans the codebase, distills key architecture context, and injects an agent preamble into all downstream agents. Keeps LLM context grounded in the actual repo.
- **`datum-go` orchestrator**: chains all 7 datum workflows end-to-end (route → awake → refine → plan → properties → act → closeout). Single entry point for the full SDLC.
- **Full TS workflow pipeline**: refine, plan, properties, validate, review, and closeout now all ship as esbuild-compiled self-contained JS. Zero Node.js module resolution at runtime.
- **`shared/models.ts`**: centralized model tier definitions (fast/balanced/deep) and tier-selection logic. Replaces scattered hardcoded model strings across workflows.
- **Prompt templates**: `route-classify.md`, `awake-scan.md`, `awake-distill.md`, `agent-preamble.md`, `agent-preamble-full.md`, `util-detect-branch.md` added to `skills/src/prompts/`.
- **TICKET template extraction**: `datum-closeout` now generates a typed TICKET.md for the next epic using headroom integration and an append protocol.
- **Closeout self-archiving**: root pipeline artifacts (TASKS.md, lane-plan.json, tasks.json, SPEC.md, TICKET.md, PROPERTIES.md) auto-archived to `docs/epics/<branch>/` on closeout.

### Changed

- **`parseAgentJson`**: now handles code fences, partial JSON, and phantom phases gracefully — no more parse panics on mildly malformed agent output.
- **Pipeline hardening**: verify gate enforces GREEN before merge; file ownership tracking in PreToolUse hook; `gate --approve` for manual overrides; yolo mode for CI; SKILL.md trimming to reduce prompt token overhead.
- **wave_builder**: cycle detection and structural validation run before act dispatch — catches malformed lane plans before committing to a TDD run.

### Fixed

- **Phantom `datum-go` phases**: removed ghost phases that appeared in the pipeline route and caused spurious agent invocations.
- **lint violations**: ruff violations in `tests/test_github_issues.py` skeleton fixed.

### Review (23 findings — 7 high/critical)

See `docs/epics/main/REVIEW-REPORT.md` for full findings. Key issues to track:

- SEC-001: shell injection risk via `ctx.branch` in `datum-closeout.ts`
- SEC-002: prompt injection via preamble interpolation in `datum-awake.ts`
- CORR-004: `datum-go` batch partitioning ignores DAG wave boundaries
- ARCH-001: Act batch loop should be extracted from `datum-go.ts` to `shared/utils.ts`

---

## [Epic 23] — 2026-05-29 (Mega Fix Session)

### Added
- **`sweep_project_memories` during closeout** (#20): Automatically flags active `project` memories in `~/.claude/projects/*/memory/` with the closing epic's branch and `updated` date.
- **AI-friendly Crash Hints**: Unhandled exceptions in `datum/cli.py`, `datum/gate.py`, and `datum/local_llm.py` now print a scrubbed traceback and explicitly instruct LLM agents to run `datum bugfile <module> "<message>" --trace "<traceback>"`.
- **Interactive bug filing**: For human users, an unhandled exception in the CLI now interactive asks `Would you like to auto-file this bug to GitHub? [y/N]` and auto-files it.
- **Traceback Sanitization**: Tracebacks are now cleanly sanitized via `_sanitize` before printing, stripping `Path.home()` and redacting any potential secrets.

### Changed
- **`project` Memory Expiration** (#20): Lowered `project` memory expiration window from 60 days to 28 days (2 sprints) in `datum/memory_audit.py` to prevent agents from relying on stale state.
- **Memory Frontmatter Schema** (#20): Formally added `created`, `updated`, `epic`, and `issues` to the memory frontmatter schema in `references/dream.md`. `datum/memory_audit.py` now parses these when validating staleness.

### Fixed
- **`max_tokens` conflation** (#42): Fixed the default config template which previously set `max_tokens` to `131072` (the full context window), causing the budget check to reject all prompts.
- **Legacy renderer refactor** (#23): Refactored the legacy render path in `datum/lane_plan.py` to reuse `_render_task_block` by adding a `heading_level` parameter.

## [Epics 19–22] — 2026-05-28

### Added
- **`datum walkthrough`** — generates `WALKTHROUGH.md` post-mortem artifact from SPEC, TASKS, git diff via `run_phase("sidecar_docs", schema=WalkthroughSummary)`. Deterministic fallback if LLM unavailable.
- **Two-tier model routing** — `fast_model` / `fast_phases` config: Llama-3.1-8B-Instruct-4bit for triage/validate (~120 t/s), Qwen3-30B-A3B-8bit for act/sidecar phases (~35 t/s). `get_model_for_phase()` routes automatically.
- **KV cache quantization** — `kv_bits=8` and `max_kv_size` config options propagate through both `stream_generate` and outlines `gen()` kwargs. ~50% KV memory reduction for Qwen3-30B.
- **`hf_cache_dir`** config option — datum sets `HF_HUB_CACHE` at load time so models on external drives work without shell env vars.
- **`TriageDecision` Pydantic schema** — `datum/models/triage_decision_schema.py` with `decision: Literal["deepen", "properties"]` and `reason: str`. Enables grammar-constrained triage via `run_phase("triage", schema=TriageDecision)`.
- **`prompt_cache` threading in `multi_turn_phase`** — cache created before turn loop, passed to structured/two_pass/vote calls. MLX accumulates KV state across turns.
- **`_cache_offset(cache)`** helper — reads `cache[0].offset` safely for MLX KVCache offset tracking.
- 24 new tests across 4 test files.

### Fixed
- **Budget check always rejected prompts** (#42) — `DEFAULTS["max_tokens"]` was 131072 (equal to `context_window`), making every `check_context_budget` return `fits=False`. Changed to 8192.
- **`datum walkthrough` wrong result key** — `result["content"]` → `result["text"]` (run_phase without schema returns `text` key, not `content`).
- **`git diff` returncode inverted** — returncode 1 = changes found (normal), 2 = error. Fixed condition to `returncode != 2`.
- **`check_questions_answered` false-flags multi-line answers** (#24) — now peeks ahead to next non-empty non-header line when `[Answer]:` has no inline text.
- **`_contracts()` opaque indexing** (#22) — all call sites now use named unpacking `validate_payload, validate_value = _contracts()`.
- Top-level import of `datum.walkthrough` in `cli.py` moved inside function body — prevents CLI startup crash if walkthrough deps fail.

### Stats
- 5 commits, 37 files, +2110 / -356 LOC, 94 tests passing

## [Epic 18] — 2026-05-28

### Added
- **Multi-turn local LLM orchestration**: plan→execute→synthesize loop with per-phase config overrides
  - Two-pass DCCD generation (arxiv 2603.03305): freeform draft then grammar-constrained extraction
  - Self-consistency voting (RASC, NAACL 2025): N-sample majority vote replaces self-reported confidence
  - Few-shot prompting (arxiv 2605.02363): example JSON injected into every prompt
  - Grammar-tight schemas: `StepResult.recommendation` is a Literal enum, all fields capped at 80 chars
  - Temperature scheduling: fixed, rising, falling, u_curve modes across turns
  - Parameterized quality gates: char flood, n-gram repetition, lexical diversity — all config-driven
- **Agent-Computer Interface (ACI)**: local model can execute tools autonomously
  - Read/write tool tiers with `enable_write_tools` gate (off by default)
  - Command injection blocking: `BLOCKED_COMMANDS` frozenset + shell operator detection
  - Path sandboxing: all string args checked against repo root, blocks escape attempts
  - `<untrusted>` XML tagging on tool output for prompt injection defense
  - Progressive disclosure: truncation with explicit `System Note` hinting
- **Lane tools**: `read_file.py`, `list_dir.py`, `grep_search.py`, `run_command.py`, `read_file_range.py`
  - All registered in `manifest.toml` with permissions and timeouts
- **CLI pipeline flags** (closes #44): `--system`, `--json`, `--max-tokens`, `--temperature`, `--strip-thinking`, `--multi-turn`, `--phase`, `--mt-turns`, `--mt-confidence`, `--mt-schedule`, `--mt-timeout`
- `datum init` now seeds AGENTS.md with full local LLM multi-turn documentation
- Multi-turn status display in `datum local-llm` (no args)

### Changed
- `datum/schemas.py`: added `StepPlan`, `StepResult`, `StepAction`, `ToolCall` schemas
- `datum/local_llm.py`: +903 lines — multi-turn engine, two-pass, voting, quality gates, ACI loop
- `datum/cli.py`: full pipeline flag suite + multi-turn interactive testing
- `assets/config.toml.default`: `[multi_turn]` section with 15 parameters + per-phase overrides + quality gates

### Fixed
- CLI crash: `Console.print(stderr=True)` replaced with `Console(stderr=True)` instance
- Multi-word prompts: `datum local-llm how many r in strawberry` works without quotes
- Shell autocompletion: `datum --install-completion` for bash, zsh, fish, powershell

### Stats
- 13 files changed, +1,554 / -16 lines
- Pair-programmed across 6 rounds between Claude (Opus 4.6) and Gemini (3.1 Pro)

## [Epic 17] — 2026-05-28

### Added
- **datum-tui**: Textual-based factory floor dashboard (`datum floor`)
  - Pipeline status panel: phase, run ID, branch, in-flight count, local LLM config
  - Lanes table: phase, status, model, retries per lane
  - Metrics panel: token cost, Gemma savings, escalation rate
  - Event log: live tail of `.datum/events.jsonl`
  - Command input: quick actions (`r` refresh, `q` quit, `s` status)
- **OpenRouter TUI reference**: Complete TypeScript reference implementation with screenshots
  - Agent loop, tool system, session management, CLI with slash commands
  - 9 screenshot demos across input styles, loaders, and tool displays
- `datum floor` CLI command to launch the TUI
- `datum-tui/test_app.py` with 4 smoke tests

### Changed
- `datum/cli.py`: added `floor` subcommand routing to `datum-tui/app.py`

### Stats
- 51 files changed, +5,345 / -3 lines

## [Epic 16] — 2026-05-28

### Added
- `datum init` now seeds hooks, config.toml, and lane-tools to every bootstrapped repo

## [Epic 15] — 2026-05-28

### Changed
- Local LLM enforcement: hook blocks shell invocation, AGENTS.md mandates Agent tool

## [Epic 14] — 2026-05-28

### Added
- Grammar-constrained generation via outlines + pydantic schemas for pipeline tasks

## [Epic 13] — 2026-05-28

### Added
- `datum --version` flag
### Fixed
- `seed_state_docs` no longer nukes existing CLAUDE.md

## [Epic 12] — 2026-05-28

### Fixed
- local-llm `chat()` import path
- SSOT `max_tokens` default resolution

## [Epic 11] — 2026-05-28

### Added
- Local LLM beta: MLX Gemma 4 26B inference with retry ladder escalation + cost tracking

## [Epic 10] — 2026-05-28

### Added
- Semantic memory extraction via MLX + Jina v5 on Apple Silicon

## [Epic 9] — 2026-05-28

### Added
- `datum dream`: first-class memory consolidation with staleness audit + transcript extraction

## [Epic 8] — 2026-05-28

### Changed
- All documentation uses `datum <command>` CLI syntax, zero `uv run` exposure

## [Epic 7] — 2026-05-27

### Added
- Rock-solid installer: prerequisite checks (git/uv/Python), `~/.local/bin/datum` wrapper, symlink registration

## [Epic 6] — 2026-05-27

### Added
- Mermaid diagram skill: 9 reference docs, 5 design templates, 3 render/validate/extract scripts

## [Epic 5] — 2026-05-27

### Added
- Self-healing: `datum bugfile` CLI + `report_bug()` with sanitized output

## [Epic 4] — 2026-05-27

### Added
- Express pipeline reference doc (`0x-express.md`) for Patch-tier routing

## [Epic 3] — 2026-05-27

### Fixed
- 6 ruff violations across artifact.py, contracts.py, prompt_loader.py

## [Epic 2] — 2026-05-27

### Fixed
- SSOT path resolution via `resolve_artifact()`
- Triage enforcement (can no longer skip)
- GitNexus-first Deepen phase
- Branch auto-increment

## [Epic 1] — 2026-05-27

### Added
- AIDLC-inspired pipeline: overconfidence gate, adaptive depth classifier, units of work
- `LANDSCAPE.md` filesystem scaffold generator
- `QUESTIONS.md` structured Q&A artifact
- 45 new tests
