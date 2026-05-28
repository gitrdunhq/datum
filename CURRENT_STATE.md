# Current State

**Last updated:** 2026-05-27
**Epic:** 8 — Documentation Cleanup

---

## What shipped

Seven epics shipped in one session:

1. **Epic 1** (PR #25) — AIDLC-inspired pipeline enhancements: overconfidence gate, adaptive depth classifier, units of work, LANDSCAPE.md, QUESTIONS.md. 45 new tests.
2. **Epic 2** (PR #26) — Post-epic-1 hardening: SSOT path resolution (`resolve_artifact()`), Triage enforcement, GitNexus-first Deepen, branch auto-increment.
3. **Epic 3** (PR #27) — Lint cleanup: 6 ruff violations across artifact.py, contracts.py, prompt_loader.py.
4. **Epic 4** (PR #28) — Express pipeline reference doc (`0x-express.md`) for Patch-tier routing.
5. **Epic 5** (PR #29) — Self-healing: `datum bugfile` CLI + `report_bug()` with sanitized output (home paths, tokens, secrets redacted).
6. **Epic 6** (PR #30) — Mermaid diagram skill ingested: 9 reference docs, 5 design templates, 3 scripts.
7. **Epic 7** (PR #31) — Rock-solid installer: prerequisite checks (git/uv/Python), `~/.local/bin/datum` CLI wrapper, README.md, consolidated symlink registration.

## Active work

Epic 8 — documentation cleanup: replacing all `uv run`/`python3 scripts/` references with `datum <command>` CLI syntax.

## Known issues

- 3 low-severity issues: #22 (opaque `_contracts()` indexing), #23 (duplicated render in lane_plan.py), #24 (inline-only answer check in gate)
- 2 pre-existing test failures in test_datum_hardening.py (pydantic-core version mismatch)
- Several `datum <subcommand>` CLI commands referenced in docs don't have CLI wrappers yet (gate, test-signal, skeleton, commit-queue, etc.) — they run via `scripts/datum.py` internally

## Architecture notes

- All user-facing commands: `datum <command>` (CLI wrapper at `~/.local/bin/datum`)
- Internal pipeline execution: `datum <module>` maps to `uv run scripts/datum.py datum.<module>` transparently
- Gate artifact resolution: `resolve_artifact()` SSOT — epic dir first, root fallback
- Model tiers: config.toml.default is the authority; every subagent spawn must include explicit `model:` param
- SPEC.md template: 9 sections (including Assumption Audit + Classification Metadata)
- Mermaid diagrams: built-in, triggered on "mermaid"/"diagram"/"visualize"
