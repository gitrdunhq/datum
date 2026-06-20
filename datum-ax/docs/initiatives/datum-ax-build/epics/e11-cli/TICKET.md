# TICKET: E11 — CLI & entry points

## Intent
Expose the orchestrator through standard terminal entry points (ADR-0012). Provide the user with commands to trigger runs, observe pipeline state, and diagnose environment health.

## Requirements
- `datum run`: Kicks off the orchestration DAG using the provided ticket or config.
- `datum status`: Queries the `StatusProvider` (E5) and outputs the LiveStatus JSON to the console.
- `datum doctor`: Checks environment health (Docker accessibility, environment variables, etc.) before runs are permitted.
- `datum-ax` entry point: Registers the CLI in `pyproject.toml`.

## Acceptance Criteria
- [ ] `datum run` correctly parses arguments and invokes the graph.
- [ ] `datum status` outputs JSON matching the LiveStatus schema.
- [ ] `datum doctor` correctly flags missing dependencies (like docker).
- [ ] Strict TDD followed.
- [ ] `uv run pytest` green.

## Constraints & NFRs
- Implement using the standard `argparse` library to keep dependencies light.
- Do not execute real heavy workflows in unit tests; use the stubs created in E5 and E6.

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
