# Roadmap

**Last updated:** 2026-06-13

---

## In Progress

- GitHub sub-issues: `datum plan` creates real GH issues with parent/child relationships, metadata in HTML comments
- Pipeline hardening: stale test cleanup, idempotent worktree setup, verify schema enforcement

## Planned

- Bedrock flex tier for overnight pipeline runs (~50% cost reduction)
- Headless orchestrator for datum-local variant
- 3-round adversarial review pipeline (#134)

## Completed

- TypeScript workflow pipeline + esbuild transpilation — 2026-06-13
- Consolidated TDD agents (14→7 per lane) — 2026-06-13
- Phase split (6 workflow files via workflow() nesting) — 2026-06-13
- Dedicated git agent (single writer pattern) — 2026-06-13
- DAG scheduler + parallel verify/reflect — 2026-06-13
- TDD Act pipeline (datum-tdd-act.js) — 2026-06-08 — 2026-06-13
- Closeout automation — 2026-06-11 — PR #56
- Epic 25 — chore: remove turret from datum — 2026-05-29
- Epic 18 — Multi-turn local LLM + ACI + lane tools — 2026-05-28
- Epic 17 — datum-tui beta (factory floor dashboard) — 2026-05-28 — PR #41
- Epics 1–16 — Core pipeline, installer, local LLM, memory, self-healing — PRs #25-#40
