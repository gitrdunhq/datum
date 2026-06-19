# TICKET: E2 — Inference layer

<!-- Emulated nl-to-ticket output for epic E2. Scale = epic. -->

## Intent
Talk to oMLX by role, safely. Implement the `InferenceClient` contract (E1) as a `data`-tier oMLX
adapter with a model-role registry, a concurrency semaphore, and token-budget enforcement — fully
testable against a mock oMLX endpoint.

## Requirements
- `OmlxInferenceClient` implementing `contracts.InferenceClient` (async `complete(role, prompt, budget)`).
- **Model-role registry**: TRIAGE / EXECUTOR / ADVERSARIAL → model id + temperature (from config).
- **Concurrency semaphore** (default `max_connections=2`, ADR-0003) around every call.
- **Budget enforcement**: estimate input tokens; reject over-budget *before* dispatch; pass
  `max_tokens = budget.max_output`.
- **OpenAI-compatible wire** (`ChatRequest`/`ChatResponse`) + a pluggable transport (a real httpx
  transport, lazily imported; a fake transport for tests).
- Typed errors: budget exceeded, timeout, unknown role, generic inference error.

## Non-Goals
- The full context firewall / prompt assembly from Serena/TokenSave/Headroom (that's E4) — E2 renders
  an already-assembled `AssembledPrompt`.
- Real oMLX calls in tests (mock only).

## Acceptance Criteria
- [ ] `complete()` returns a typed `Completion` (role, model_id, token usage) from a mock transport.
- [ ] `OmlxInferenceClient` satisfies the `InferenceClient` protocol (`isinstance`).
- [ ] N parallel calls never exceed `max_connections` (observed peak ≤ cap).
- [ ] Over-budget prompt raises `BudgetExceededError` and the transport is **never called**.
- [ ] Request carries the role's temperature and `max_tokens = budget.max_output`.
- [ ] A slow transport past the timeout raises `InferenceTimeoutError`.
- [ ] `uv run pytest` green; tier-boundary guard still passes (data → contracts only).

## Constraints & NFRs
- `data` tier; imports contracts/schemas/base only (ADR-0026). Strict Pydantic; Hypothesis property
  tests. No network in tests (async via `asyncio.run`, no pytest-asyncio dep).

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
