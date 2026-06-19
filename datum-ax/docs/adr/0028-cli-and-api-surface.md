# ADR-0028: CLI + API Surface (presentation tier) — kick off any stage

## Status

Accepted (design)

## Context

datum-ax needs to be easy to drive: run a whole pipeline, but also **kick off individual stages**
(refine a ticket, plan an epic, run one lane, resume a suspended run) for development, debugging, and
CI. This is a presentation-tier concern — ADR-0026 already reserves the presentation tier for "CLI,
agent, skills, composition root" — so it is **additive**, not a rework; it touches no contracts.

## Decision

Expose two thin entry points in the **presentation tier**, both delegating to the same `core`
orchestration (which is given `data` adapters by the composition root via `contracts`):

- **CLI** (`datum-ax …`) — the primary local driver. Subcommands map to ROUTE shapes and to single
  stages, e.g.:
  - `datum-ax run <epic>` (full route) · `datum-ax intake "<text>"` (nl-to-ticket) ·
    `datum-ax refine|plan|properties|act|validate|review <epic>` · `datum-ax lane <id>` ·
    `datum-ax resume <run-id>`.
- **API** (HTTP) — the same operations as endpoints for remote/CI/agent triggers; long-running stages
  return a `run-id` and stream/poll status.

Rules:
- **Thin presentation.** Both surfaces only parse input, call `core`, and render output. No business
  logic lives here (ADR-0026).
- **Stages are independently invocable** because state is checkpointed (Valkey, ADR-0002) and phases
  read/write typed JSON artifacts (ADR-0027) — a stage can start from the last artifact/checkpoint.
- **Dual output.** Human-readable to the terminal (Markdown/rich), machine-readable JSON with
  `--json` (ADR-0027) so CI/agents branch on structured results.
- **Same auth/secret rules.** The CLI/API run on the orchestrator and hold credentials; sandboxes
  never do (ADR-0011).

## Consequences

- Any stage can be triggered, replayed, or resumed in isolation — essential for development and CI.
- It is epic **E10** in the build roadmap (with `nl-to-ticket` already started); nothing built so far
  changes.
- CLI and API share one core path, so they can't diverge in behavior.
- A partial invocation that lacks a prerequisite artifact fails deterministically at the input-schema
  boundary (ADR-0027), with a clear "missing/invalid handoff" error.
</content>
