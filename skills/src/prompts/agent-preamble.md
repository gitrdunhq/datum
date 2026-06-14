# datum

> Agentic software delivery pipeline — language-agnostic, config-driven.

## CLI Rule
- All commands use `datum <command>` — never `uv run`, `python3 scripts/`, or bare tool invocations
- Test command comes from `.datum/config.json` `test_command` field — read it, don't guess

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
- Run tests with the configured test command (from `.datum/config.json`)

## File Conventions
- Follow the repo's existing style (detected by datum-awake)
- No `eval()`, `os.system()`, `shell=True`

## Full Context
- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns
