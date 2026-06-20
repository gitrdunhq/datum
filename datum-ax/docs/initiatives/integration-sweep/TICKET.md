# TICKET: Integration Sweep — Make the flow "real"

## Intent
Replace the architectural stubs in the pipeline with real LangGraph nodes and live inference calls to make the `datum-ax` flow fully operational against the user's `oMLX` environment.

## Requirements
- Add `langgraph` to `pyproject.toml` dependencies.
- Replace the `StubGraph` in the orchestration core (E6) with a real `langgraph.graph.StateGraph`, wiring the proper conditional edges.
- Inject the `OmlxInferenceClient` (built in E2) into the planner (E7) and verifier (E8) nodes to replace hardcoded mock outputs with real model completions.
- Integrate the **`ContextCrane`** (E4, ADR-0030 — the single source of truth for assembly; replaced
  the retired `PromptAssembler`) into the nodes to assemble the `AssembledPrompt` packets before
  dispatching to the inference client. See `GAP-LEDGER.md` for the full MVP→aspirational backlog.

## Non-Goals
- Adding new feature epics (E1-E11 scope is already complete).
- Modifying the existing data contracts or boundaries.

## Acceptance Criteria
- [ ] `langgraph` is successfully integrated, and the state machine correctly passes the `OrchestratorState` through the nodes.
- [ ] The planner node invokes `OmlxInferenceClient` and generates a structured DAG.
- [ ] The verifier node invokes `OmlxInferenceClient` to synthesize real test and implementation diffs.
- [ ] The prompt assembler feeds live codebase context to the model calls.
- [ ] Running the CLI `datum run` with a test ticket triggers a real LLM compilation loop.

## Constraints & NFRs
- Must strictly use the `OmlxInferenceClient` interfaces to ensure budget/tokenomics are respected.
- The user's local `oMLX` environment variables are assumed to be present.

## Assumptions
- The transition from `StubGraph` to `StateGraph` will map 1:1 to the existing stubbed sequence (`ROUTE` -> `PhaseA` -> `PhaseB` -> `CLOSEOUT`).

## Open Questions
- [blocking? no] Should we execute a full end-to-end task through the pipeline as the final acceptance test for this ticket, or just verify the integration points?

## Classification
- Complexity: System
- Scope: broad
- Ambiguity: low
- Suggested route: feature
