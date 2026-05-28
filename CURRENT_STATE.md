# Current State

**Last updated:** 2026-05-28
**Epic:** 18 — Multi-turn local LLM + ACI

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
18. **Epic 18** (11333ba) — Multi-turn local LLM pipeline: DCCD two-pass, N=3 voting, few-shot, ACI tool execution, 5 lane tools, CLI pipeline flags. Pair-programmed Claude×Gemini across 6 rounds.

## Active work

None. Epic 18 committed to main. Pipeline idle.

## Known issues

- #42 (datum-bug) — `max_tokens` config conflated with `context_window`, budget check rejects all prompts
- #24 — `check_questions_answered` only checks inline answers (gate.py)
- #23 — Legacy render path duplicates `_render_task_block` (lane_plan.py)
- #22 — `_contracts()` tuple indexing is opaque (gate.py)
- #20 — Memory project-state records lack timestamps/epic stamps
- #19 — `self_check` path prefix mismatch (scripts/ vs package root)

## Architecture notes

- All user-facing commands: `datum <command>` (CLI wrapper at `~/.local/bin/datum`)
- `datum floor` launches the Textual TUI dashboard (reads `.datum/` state files, loosely coupled)
- Local LLM: MLX Gemma 4 26B via Python API only (never shell). Grammar-constrained output via outlines.
- Multi-turn: plan→execute→synthesize with two-pass DCCD, N-sample voting, few-shot prompting
- ACI: local model can execute lane tools (read-only by default, write tools gated separately)
- Lane tools: read_file, list_dir, grep_search, run_command, read_file_range — manifest-gated with resource limits
- Memory: `datum dream` runs staleness audit + MLX semantic extraction (Jina v5)
- `datum init` bootstraps repos: hooks, config.toml, lane-tools, AGENTS.md (now includes local LLM docs)
- Gate artifact resolution: `resolve_artifact()` SSOT — epic dir first, root fallback
- Model tiers: config.toml is the authority; every subagent spawn must include explicit `model:` param
