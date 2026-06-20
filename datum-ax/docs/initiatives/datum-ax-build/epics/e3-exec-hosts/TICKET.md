# TICKET: E3 — Execution hosts

## Intent
Run model-generated code off the orchestrator. Implement the `ExecutionHost` contract (E1) in the `data` tier, providing isolated sandboxes for diff application, testing, linting, and artifact collection, with guaranteed teardown.

## Requirements
- `X86DockerHost` (concrete) implementing `contracts.ExecutionHost`. Runs in an ephemeral Docker container.
- `MacOSTartHost` (stub) implementing `contracts.ExecutionHost`. Raises `NotImplementedError` for now.
- `apply_diff`: Takes a `UnifiedDiff`, uses `patch` to apply it atomically. If conflicts, return `applied=False` with conflict details.
- `run_tests`: Runs tests using a provided selector (e.g. `pytest` or `npm test`), capturing exit code, stdout, stderr, and duration.
- `run_lint`: Runs a linter on specified paths, capturing findings.
- `collect_artifacts`: Glob search to collect artifacts with their sizes.
- `reset`: Teardown the sandbox, killing the container.
- Use `subprocess` to orchestrate docker/podman.

## Acceptance Criteria
- [ ] `X86DockerHost` satisfies the `ExecutionHost` protocol (`isinstance`).
- [ ] `MacOSTartHost` satisfies the `ExecutionHost` protocol but raises NotImplementedError.
- [ ] `apply_diff` successfully applies a valid diff and returns `ApplyResult(applied=True)`.
- [ ] `apply_diff` handles conflicts, returning `ApplyResult(applied=False, conflicts=...)`.
- [ ] `run_tests` captures results correctly for both passing and failing test commands.
- [ ] `reset` correctly removes the container.
- [ ] `uv run pytest` green; tier-boundary guard still passes (data → contracts only).

## Constraints & NFRs
- `data` tier; imports contracts/schemas/base only.
- Strict Pydantic; Hypothesis property tests where applicable.
- No dangling containers on teardown or crash.

## Classification
- Complexity: Feature · Scope: narrow · Ambiguity: low · Suggested route: feature
