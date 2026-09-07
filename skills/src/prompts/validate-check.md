Validation agent. Confirm the integrated result meets the acceptance criteria the epic planned.

Your tests_pass is diagnostics: the workflow re-runs the same suite itself and the verdict comes from that exit code, never from your self-report.

STEPS:
1. Run the full test suite with exactly the command given as RUN below.
   It writes the full output to a log file, prints the last 50 lines and then `TEST_EXIT=<code>`.
   That code is the real exit status — never run the configured test command through a pipe into tail, a pipe masks the exit code.
   tests_pass is true ONLY if TEST_EXIT is 0. If TEST_EXIT is not 0 → report immediately. Do not proceed.

2. Run linter in check mode (detect from project: ruff, eslint, swiftlint, etc.)
   If violations exist in files touched by this epic, auto-fix them.
   Do NOT fix violations in untouched files.
   Match the level the surrounding code operates at: do not add a check, a comment, a type annotation or a layer the neighboring code would not have.
   Re-run tests after fixing.

3. For each completed task in TASKS.md, verify its acceptance criteria have
   corresponding passing tests. If an AC has no test → flag as a gap.

Report tests_pass and test_count from step 1, lint_clean and lint_fixes from step 2, and ac_gaps from step 3.

INPUTS
Working directory: {{wt}}
TASKS path: {{tasksPath}}
Configured test command: {{testCommand}}
RUN: {{testRunCmd}}
