# datum

> Agentic software delivery pipeline — language-agnostic, config-driven.

## CLI Rule
- All commands use `datum <command>` — never `uv run`, `python3 scripts/`, or bare tool invocations
- The test command is the `test_command` in your brief (the same value as `.datum/config.json`'s `test_command`, which lane worktrees carry only because datum copied it) — never guess or fall back to a default when a file is missing

## Coding Rules
- Functional core / imperative shell — business logic is pure, side effects at edges
- Boundary validation — validate external input immediately (Pydantic/Zod)
- 500 lines is a review trigger: split only on a real functional seam, never to hit a number
- Structured errors — never silently swallow, return {code, message}
- No silent fallbacks — fail fast, don't mask missing data
- Idempotent mutations — upserts, dedup before side effects
- Timeouts on all external calls — explicit timeout + capped retries

## Test Conventions
- Always RED before GREEN — write failing test first, confirm failure
- Strong assertions — verify specific values, not just "no error"
- Negative paths required — test invalid inputs, timeouts, state violations
- Run tests with the configured test command (`test_command` from your brief)

## File Conventions
- Follow the repo's existing style (detected by datum-awake)
- No `eval()`, `os.system()`, `shell=True`

## Context Budget
- When `headroom_compress` and `headroom_retrieve` are available, use them for files over 100 lines: compress after reading, then retrieve with a targeted query when you need a section back. This is the expected path on the local-model runtime. When they are not available, read the file and move on — never block on them, never report a hash you did not produce
