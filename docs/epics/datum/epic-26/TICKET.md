# TICKET: datum-local M0+M1 — sibling repo scaffold + prove the local write path

## Request

Bootstrap `gitrdunhq/datum-local` — the standalone, strictly-local, headless datum variant — and prove its single riskiest assumption: that a local model can drive a write→test→commit loop end-to-end with zero Claude/Anthropic calls.

This is the first epic of an approved architecture (full plan: `~/.claude/plans/i-would-like-to-cozy-eclipse.md`, summarized below). Scope is **M0 + M1 only**.

## Background (approved architecture, condensed)

datum-local is a sibling repo that reuses datum's harness-independent core (state, gate, pipeline_scheduler, commit_queue, local_llm, models/schemas, lane-tools) via an **editable path dependency** (`../datum`) — datum's wheel packaging excludes assets/references/lane-tools and `path_utils.py` resolves from the source tree, so editable-from-checkout is the only working install shape today. Strictly local: the Claude escalation ladder is replaced by a local-only policy (retry → self-consistency → bigger local tier → halt with FailureReport). Later milestones add the headless orchestrator, ported phases, datumd chat API, and web/TUI frontends — all out of scope here.

## Scope

### M0 — Repo scaffold
- Create `../datum-local/` (sibling checkout next to this repo): pyproject with `[tool.uv.sources] datum = { path = "../datum", editable = true }`, package skeleton `datum_local/`, README stating the architecture decisions.
- **Contract-test suite**: imports the datum surfaces datum-local depends on (`datum.state`, `datum.gate`, `datum.local_llm.run_phase`/`multi_turn_phase`, `datum.pipeline_scheduler`, `datum.commit_queue`, `datum.models`) and asserts their signatures — fails loudly on upstream drift.
- Config overlay: datum-local config enabling `[local_llm]` with the existing model stack (Qwen3-30B-A3B-8bit main, Llama-3.1-8B-Instruct-4bit fast, oMLX at localhost:12200), `enable_write_tools = true`, budget caps.

### M1 — Prove the write path
- A bare driver script (no orchestrator yet) that runs `multi_turn_phase` with `enable_tool_execution = true` and `enable_write_tools = true` on a **fixture repo** (tiny toy Python project committed as a test fixture).
- One toy task: the local model writes a failing test (RED), then makes it pass (GREEN), commits landing on a branch via commit_queue.
- This doubles as the live end-to-end tool-calling test that epic-24 never ran.

## Acceptance

1. `uv run pytest` green in datum-local, including contract tests, with datum imported via the editable path dep.
2. The M1 driver completes RED→GREEN on the fixture repo with zero human input in ≥4 of 5 consecutive runs; commits present on the fixture branch.
3. `.datum/local-llm-metrics.jsonl` from the M1 runs contains **no Claude/Anthropic model IDs** — every inference event names a local model.
4. Failure runs (if any) produce a structured failure record, not a silent stall.

## Constraints

- **Cross-repo wrinkle (explicit):** deliverables live in `../datum-local`, outside this repo's lane sandbox (lane-tools confine writes to repo root). The plan must address this — e.g., bootstrap script + work executed in the sibling checkout, with this epic's artifacts (spec, tasks, reports) committed here under `docs/epics/datum/epic-26/`.
- No changes to datum core required by the plan (editable install works as-is); if any upstream fix proves necessary (e.g., `prompt_loader.py` path resolution), it lands in this repo within this epic, minimally.
- Local LLM via Python API only, never shell (`datum.local_llm` / subagent).
- No new external dependencies beyond FastAPI-ecosystem basics already deferred to later milestones; M0+M1 should need nothing not already in datum's stack.

## Out of scope

Headless PipelineDriver/orchestrator (M2), porting refine/plan/deepen/properties (M3), review+PR publishing (M4), datumd API + chat (M5-M6), packaging fix for non-editable installs (M7).
