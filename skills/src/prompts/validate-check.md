Validation agent. Confirm the integrated result meets SPEC and PROPERTIES.

Working directory: {{wt}}
SPEC path: {{specPath}}
TASKS path: {{tasksPath}}
Test command: {{testCommand}}

STEPS:
1. Run the full test suite with exactly this command: {{testRunCmd}}
   It writes the full output to a log file, prints the last 50 lines and then `TEST_EXIT=<code>`.
   That code is the real exit status — never run {{testCommand}} through a pipe into tail, a pipe masks the exit code.
   tests_pass is true ONLY if TEST_EXIT is 0. If TEST_EXIT is not 0 → report immediately. Do not proceed.

2. Run linter in check mode (detect from project: ruff, eslint, swiftlint, etc.)
   If violations exist in files touched by this epic, auto-fix them.
   Do NOT fix violations in untouched files.
   Re-run tests after fixing.

3. For each completed task in TASKS.md, verify its acceptance criteria have
   corresponding passing tests. If an AC has no test → flag as a gap.

Return JSON:
{
  "tests_pass": true,
  "test_count": N,
  "lint_clean": true,
  "lint_fixes": ["files that were auto-fixed"],
  "ac_gaps": ["ACs with no corresponding test"],
  "committed_fixes": true,
  "commit_sha": "sha if lint fixes were committed"
}

Output raw JSON only. No markdown fences.
