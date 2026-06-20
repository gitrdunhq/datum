# TICKET: E6 — Orchestration core (LangGraph)

## Intent
Build the LangGraph state machine (the orchestrator). Provide the state schema and the graph skeleton that consumers (Phase A Planner, Phase B Verify loop) will hook into. Establish ROUTE entry points, wave-based scheduling, and interrupt/resume functionality backed by the Valkey checkpointer (E5).

## Requirements
- `OrchestratorState`: TypedDict representing the overall pipeline state in the graph (ticket, DAG, waves, failures).
- `build_graph()`: Constructs the LangGraph with stub nodes for Phase A and Phase B.
- **Interrupt/Resume**: Configured to break before execution of a node if a human needs to review (or upon failure), with the ability to resume from the Valkey checkpointer.
- **Wave Scheduler**: Basic logic to select the next disjoint set of lanes from the DAG to execute.

## Acceptance Criteria
- [ ] `OrchestratorState` captures necessary fields (ticket, DAG, current wave, results).
- [ ] A fake ticket passed to the graph traces through `ROUTE` -> `PhaseA (Stub)` -> `PhaseB (Stub)` -> `CLOSEOUT (Stub)`.
- [ ] Interrupt and resume flow operates successfully across graph boundaries.
- [ ] Tier boundary guard passes (core -> data/contracts).

## Constraints & NFRs
- `core` tier implementation (`src/datum_ax/core/orchestration`).
- Use `langgraph` (add to `pyproject.toml` if necessary) or a barebones state machine mock if `langgraph` is not yet available in deps. Wait, `langgraph` is Python. I'll mock the graph skeleton if langgraph isn't in `pyproject.toml`, but typically we install it or stub it.
- Strict TDD (RED then GREEN).

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
