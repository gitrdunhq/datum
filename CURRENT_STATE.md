# Current State

**Last updated:** 2026-05-29
**Epic:** 23 — Mega Fix Session

---

## What shipped

Seventeen epics across two sessions:

### Session 1 (Epics 1–7)

1. **Epic 1** (PR #25) — AIDLC-inspired pipeline enhancements: overconfidence gate, adaptive depth classifier, units of work, LANDSCAPE.md, QUESTIONS.md. 45 new tests.
2. **Epic 2** (PR #26) — Post-epic-1 hardening: SSOT path resolution (`resolve_artifact()`), Triage enforcement, GitNexus-first Deepen, branch auto-increment.
3. **Epic 3** (PR #27) — Lint cleanup: 6 ruff violations across artifact.py, contracts.py, prompt_loader.py.
4. **Epic 4** (PR #28) — Express pipeline reference doc (`0x-express.md`) for Patch-tier routing.
5. **Epic 5** (PR #29) — Self-healing: `datum bugfile` CLI + `report_bug()` with sanitized output.
6. **Epic 6** (PR #30) — Mermaid diagram skill ingested: 9 reference docs, 5 design templates, 3 scripts.
7. **Epic 7** (PR #31) — Rock-solid installer: prerequisite checks, `~/.local/bin/datum` wrapper, symlink registration.

### Session 2 (Epics 8–17)

8. **Epic 8** (PR #32) — Documentation cleanup: all prose uses `datum <command>`, zero `uv run` exposure.
9. **Epic 9** (PR #33) — `datum dream`: first-class memory consolidation with staleness audit + transcript extraction.
10. **Epic 10** (PR #34) — Semantic memory extraction via MLX + Jina v5 on Apple Silicon.
11. **Epic 11** (PR #35) — Local LLM beta: MLX Gemma 4 26B inference with retry ladder escalation + cost tracking.
12. **Epic 12** (PR #36) — Fix: local-llm `chat()` import + SSOT max_tokens default.
13. **Epic 13** (PR #37) — `datum --version` flag + fix seed_state_docs CLAUDE.md overwrite bug.
14. **Epic 14** (PR #38) — Grammar-constrained generation via outlines + pydantic schemas for pipeline tasks.
15. **Epic 15** (PR #39) — Enforce local LLM via subagent only: hook blocks shell, AGENTS.md mandates Agent tool.
16. **Epic 16** (PR #40) — `datum init` seeds hooks, config, and lane-tools to every initted repo.
17. **Epic 17** (PR #41) — datum-tui beta: Textual factory floor dashboard + OpenRouter TUI reference implementation.
18. **Epic 18** (11333ba) — Multi-turn local LLM pipeline: DCCD two-pass, N=3 voting, few-shot, ACI tool execution, 5 lane tools, CLI pipeline flags, shell autocompletion.
19. **Epic 19** (b7c099e) — `datum walkthrough` cmd + pipeline hardening: two-tier model routing (fast_model/fast_phases), KV cache quantization (kv_bits=8, max_kv_size), hf_cache_dir config, WalkthroughSummary schema, bug fixes from code review.
20. **Epic 20** (0efdb62) — Budget check bug fix: DEFAULTS[max_tokens] 131072→8192. prompt_cache threading in multi_turn_phase. _cache_offset helper.
21. **Epic 21** (0166399) — TriageDecision Pydantic schema: grammar-constrained triage output via run_phase("triage", schema=TriageDecision).
22. **Epic 22** (712be36) — gate.py hardening: check_questions_answered peek-ahead for multi-line answers, _contracts() named unpacking.
23. **Epic 23** (Mega Fix Session) — Closed all 16 outstanding issues: config.toml `max_tokens` vs `context_window` decoupling, legacy render refactor for lane_plan, memory frontmatter schema expansion (created, updated, epic, issues) with 28-day expiration, auto-memory sweeping during `datum closeout`, and AI-friendly sanitized crash tracebacks with self-healing GitHub issue hints.

## Active work

oMLX backend development.

## Known issues

- *All outstanding hitlist issues resolved in Epic 23. Zero known issues!*

## Architecture notes

- All user-facing commands: `datum <command>` (CLI wrapper at `~/.local/bin/datum`)
- Local LLM: two-tier routing — fast_model (Llama-3.1-8B) for triage/validate, model (Qwen3-30B-A3B-8bit) for act/sidecar phases
- KV cache: kv_bits=8 quantization + max_kv_size rotating buffer, flows through both stream_generate and outlines gen()
- hf_cache_dir: datum sets HF_HUB_CACHE from config at load time; all models on /Volumes/Extra/mlx-models
- Grammar-constrained output: outlines for structured phases; TriageDecision schema now used for triage
- Multi-turn: prompt_cache created before turn loop, threaded through structured/two_pass/vote calls
- Gate: check_questions_answered now peeks ahead for multi-line answers
- Memory: `datum dream` runs staleness audit + MLX semantic extraction (Jina v5)
- Model tiers: config.toml is the authority; every subagent spawn must include explicit `model:` param
