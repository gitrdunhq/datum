# Roadmap

**Last updated:** 2026-05-28

---

## Planned

- Closeout automation: implement collector scripts + collate + synthesis pipeline (`08-closeout.md`)
- Fix #42: max_tokens / context_window conflation in local-llm budget check
- Self-healing integration into gate.py try/except paths (auto-call `report_bug` on crashes)
- CLI subcommand wrappers for internal pipeline commands (gate, test-signal, skeleton, commit-queue, etc.)
- Fix #19: self_check path prefix mismatch
- Full `/dream` integration as closeout Stage 2 step 5

## Completed

- Epic 17 — datum-tui beta (factory floor dashboard) — 2026-05-28 — PR #41
- Epic 16 — `datum init` seeds hooks/config/lane-tools — 2026-05-28 — PR #40
- Epic 15 — Enforce local LLM via subagent only — 2026-05-28 — PR #39
- Epic 14 — Grammar-constrained generation (outlines + pydantic) — 2026-05-28 — PR #38
- Epic 13 — `datum --version` flag — 2026-05-28 — PR #37
- Epic 12 — Fix local-llm chat import + SSOT max_tokens — 2026-05-28 — PR #36
- Epic 11 — Local LLM beta (MLX Gemma inference) — 2026-05-28 — PR #35
- Epic 10 — Semantic memory extraction (MLX + Jina v5) — 2026-05-28 — PR #34
- Epic 9 — `datum dream` (memory consolidation) — 2026-05-28 — PR #33
- Epic 8 — Documentation cleanup (datum CLI) — 2026-05-28 — PR #32
- Epic 7 — Rock-solid installer — 2026-05-27 — PR #31
- Epic 6 — Mermaid diagram skill ingested — 2026-05-27 — PR #30
- Epic 5 — Self-healing (`datum bugfile`) — 2026-05-27 — PR #29
- Epic 4 — Express pipeline reference doc — 2026-05-27 — PR #28
- Epic 3 — Lint cleanup — 2026-05-27 — PR #27
- Epic 2 — Post-epic-1 hardening — 2026-05-27 — PR #26
- Epic 1 — AIDLC-inspired pipeline enhancements — 2026-05-27 — PR #25
