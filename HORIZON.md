# DATUM Horizon

Ideas parked for future evaluation when the architecture dictates necessity.

## Fleet Command (Global Registry & Aggregation)
- **Concept:** Manage multiple DATUM-aware repos from a global control plane (`datum fleet status`).
- **Risks:** Centralized state registries (e.g. `~/.datum/fleet.json`) are brittle and easily fall out of sync when directories are moved or deleted.
- **Shelved:** Keep orchestration scoped to the repository boundary for now. Rely on the host tool (or a simple filesystem scan) to manage multiple environments.

## Dual Mode (Headless Runner)
- **Concept:** Allow DATUM to run autonomously using an embedded LLM client (`litellm`), removing the need for a host tool like Claude Code or DATUM to drive the pipeline.
- **Risks:** Couples orchestration engine with inference execution. Adds complexity of context windows, API retries, and token limits to DATUM. Could end up poorly recreating DATUM.
- **Shelved:** Keep DATUM as a deterministic referee and guardrail. Let external agents remain the only drivers.

## DATUM V3: Dual Pipeline Architecture
- **Concept:** "Two pipelines, both alike in dignity." Splitting DATUM into an upstream Product Pipeline (ideation, PRDs, discovery) that feeds seamlessly into the downstream Engineering Pipeline (refine, plan, act).
- **Risks:** Scope creep. Building product management orchestration before the engineering factory is perfectly dialed in risks building a system that designs great tickets but fails to write the code.
- **Shelved:** Await V2 stabilization before assimilating the `datum-orchestrator` and `datum-ba` skill trees.
