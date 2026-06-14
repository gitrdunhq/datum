# datum

> Agentic software delivery pipeline. Python 3.12+, uv, ruff, pytest.

## Coding Rules
- Functional core / imperative shell — business logic is pure, side effects at edges
- Boundary validation — validate external input immediately (Pydantic/Zod)
- 500-line file cap — split via functional seams
- Structured errors — never silently swallow, return {code, message}
- No silent fallbacks — fail fast, don't mask missing data
- Idempotent mutations — upserts, dedup before side effects
- Timeouts on all external calls — explicit timeout + capped retries

## Test Conventions
- Always RED before GREEN — write failing test first, confirm failure
- Strong assertions — verify specific values, not just "no error"
- Negative paths required — test invalid inputs, timeouts, state violations
- Use `uv run pytest` — never bare `pytest`
- Test naming: `test_<function>_<scenario>`

## File Conventions
- Python: snake_case, type hints, ruff-formatted
- Imports: absolute from package root
- No `eval()`, `os.system()`, `shell=True`
- No bare `python` — always `uv run python`

## Full Context
- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns
