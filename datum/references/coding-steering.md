# WFC Coding Steering (Distilled)

This document consolidates 12 fragmented Claude rule files into a single, token-efficient steering doctrine for LLM context injection. 

## Core Architecture (DPS)
- **DPS-100**: **Three-Tier Separation**. Presentation (I/O, formatting), Logic (pure business rules), Data (persistence). Presentation never touches Data directly.
- **DPS-101**: **Functional Core / Imperative Shell**. Business logic must be pure (data in, data out). All side effects (DB, HTTP) live at the edges.
- **DPS-102**: **Boundary Validation**. Validate external input shape (Pydantic/Zod) immediately at the boundary. No logic executes on unvalidated payloads.
- **DPS-103**: **File Size Cap**. Hard cap of 500 lines per file. Split via functional seams, not arbitrary line cuts.

## Resiliency & State
- **DPS-200**: **Timeouts & Retries**. Every external call (HTTP, DB, subprocess) must have an explicit timeout and capped backoff retry (e.g. `tenacity`).
- **DPS-201**: **Idempotency**. All mutating operations must be idempotent (upserts, idempotency keys, dedup before side-effects).
- **DPS-202**: **Explicit State**. Represent state via Enums/Literals. Transitions must be guarded and explicit.
- **DPS-203**: **Structured Errors**. Errors must never be silently swallowed. API errors must return `{ code, message, correlationId }`.
- **DPS-204**: **No Silent Fallbacks**. Never use `??` or `||` to mask data that shouldn't be missing. Throw and fail fast instead.

## Feature Flags & Rollbacks
- **DPS-300**: **Mandatory Feature Flags**. All agent-generated features must be gated behind a feature flag (defaulting to OFF). This ensures that if the agent hallucinates or introduces a production regression, the feature can be disabled instantly without requiring a massive `git revert` or emergency hotfix.

## Testing & TDD
- **TDD-001**: **Red-Green Mandatory**. Always write the failing test first (RED), confirm the failure, then write code (GREEN). Post-hoc testing is forbidden.
- **TDD-002**: **Strong Assertions**. Tests must verify specific business outcomes. If deleting the function body doesn't fail the test, the test is worthless.
- **TDD-003**: **No Fake Logic**. Do not hardcode return values just to make tests pass.
- **TDD-004**: **Negative Paths Required**. Always test invalid inputs, retry exhaustion, timeouts, and state violations.

## AI & Tooling Discipline
- **AI-001**: **Zero Bash Readers**. NEVER use `cat`, `head`, `tail`, or `less` in a Bash tool to read files. Use the native Read/View tool.
- **AI-002**: **No Invented APIs**. Do not call APIs, methods, or imports that you haven't confirmed exist in the codebase or official docs.
- **AI-003**: **Minimal Diffs**. Only change what is required for the task. No drive-by rewrites or unrequested refactors.
- **AI-004**: **Preserve Debug Logs**. Never remove diagnostic logs in the same commit as a bug fix.
- **AI-005**: **Memory Recall First**. Always query `wfc helpers recall "<task>"` before implementing to check for prior decisions/findings.

## Python Specifics
- **PY-001**: **Toolchain**. Python 3.12+, `uv`, `black`, `ruff`, `pytest`, `httpx`, `structlog`, `orjson`.
- **PY-002**: **Execution**. Never use bare `python` or `pytest`. Always use `uv run python` and `uv run pytest`.

## Safeguard & Security
- **SEC-001**: **No Dynamic Execution**. `eval()`, `os.system()`, `shell=True` are blocked via PreToolUse hooks.
- **SEC-002**: **Lockfiles Mandatory**. Never install packages without a lockfile. Reject dependencies published <90 days ago.
