# Changelog

All notable changes to DATUM are documented here.

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
