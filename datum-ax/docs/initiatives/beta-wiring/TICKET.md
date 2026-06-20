# TICKET: Beta Wiring

## Intent
Wire the execution graph and CLI to connect to the network and invoke the actual pipeline logic, bringing the `datum-ax` orchestration engine to a functional beta state capable of executing end-to-end runs against a local `oMLX` instance.

## Requirements
- Update `cli/main.py` to read `OMLX_BASE_URL` and `OMLX_API_KEY` from environment variables.
- Instantiate an `httpx`-backed `OmlxTransport` and build the `OmlxInferenceClient`.
- Pass the instantiated `InferenceClient` into the LangGraph state/nodes (e.g., via `RunnableConfig` or state injection).
- Update the nodes in `graph.py` to invoke the real underlying modules (`triage_ticket`, `VerificationLoop`, etc.) instead of simply appending to the `visited_nodes` list.
- Invoke the compiled `StateGraph` in `cli/main.py` when `datum run --ticket` is called.

## Non-Goals
- Adding new pipeline features outside the E1-E11 blueprint.
- Building complex error recovery beyond what Phase B and Phase C already handle.

## Acceptance Criteria
- [ ] Running `datum run --ticket <path>` successfully parses environment variables and instantiates the inference client.
- [ ] The CLI invokes the compiled LangGraph state machine.
- [ ] The graph nodes correctly pass the `InferenceClient` to the planner and verifier logic.
- [ ] The pipeline makes real HTTP network calls to the `oMLX` API endpoint and processes the completions.

## Constraints & NFRs
- Maintain type safety and contract adherence (strict JSON parsing for completions).
- Handle missing environment variables gracefully, terminating with a clear error message in the CLI before the graph starts.

## Assumptions
- The user has a valid local `oMLX` environment running with compatible models.

## Open Questions
- [blocking? no] Should we inject the inference client into the LangGraph state dictionary directly, or pass it via `RunnableConfig` metadata?

## Classification
- Complexity: System
- Scope: broad
- Ambiguity: low
- Suggested route: feature
