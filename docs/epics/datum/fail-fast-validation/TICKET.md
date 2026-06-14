# Fail-Fast Deterministic Validation Before Tests

## What
Add a deterministic pre-check step in `datum-tdd-act-lane.ts` that runs ruff (linter) and mypy (type checker) on generated code BEFORE running pytest. These checks are sub-second, deterministic, and catch ~40% of errors (syntax, imports, type mismatches) before the expensive test execution.

## Requirements
- After GREEN agent writes implementation code, run `ruff check --output-format=json <files>` on the impl files
- If ruff finds errors, pass structured error output (line numbers, error codes, messages) back to a GREEN retry — do NOT run pytest yet
- After ruff passes, run `mypy --no-error-summary <files>` on the impl files  
- If mypy finds type errors, pass structured output back to GREEN retry — do NOT run pytest yet
- Only run pytest after both ruff AND mypy pass (fail-fast ordering)
- Track which check caught the error in the lane outcome for observability
- These checks are deterministic — no LLM agent needed, just subprocess calls in the workflow TS code

## Not This
- Don't add ruff/mypy to the RED phase — RED tests are supposed to fail
- Don't block on warnings, only errors
- Don't add new dependencies — ruff and mypy are already in the dev environment
- Don't change the existing pytest verification flow — this is a pre-filter, not a replacement

## References
- `skills/src/datum-tdd-act-lane.ts` — the GREEN phase and verify step
- Article pattern: "run cheap, fast checks first and expensive ones last"
- Fail-fast ordering: syntax (ms) → lint (s) → type check (s) → tests (s-min)
