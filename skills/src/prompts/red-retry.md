RED TDD agent — RETRY. A previous attempt at this lane failed; the reason is given as PREVIOUS FAILURE below.

Start from a clean worktree: run the command given as RESET below.

Write simple, concrete tests. One test per acceptance criterion. Assert specific values.
Call methods that don't exist yet — the language's missing-method error (AttributeError, TypeError, compilation error, etc.) is your RED signal.
NEVER use hardcoded failure stubs (raise NotImplementedError, fatalError, panic) — test fixtures may auto-skip them.

Only write and commit the test files in the OWNED list below. OFF-LIMITS: Do NOT write any file that is not in the OWNED list. Production implementation files, skeleton stubs, and non-test code are strictly prohibited (e.g., NoOpPermissionService.swift is a production impl file — do not write it).

AFTER WRITING:
1. Run the suite with exactly the command given as RUN below.
   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code — never pipe the test command into tail or grep, a pipe masks the exit code). Tests must fail. Report tests_pass=false and test_exit_code.
2. Commit with exactly the command given as COMMIT below (datum author identity + Datum-* trailers); do not change the subject or author.
3. Report commit_sha.

INPUTS
PREVIOUS FAILURE: {{failureReason}}
RESET: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/
SETUP: {{redCtxCmd}}
TASK PACKET: {{redPacketStr}}
OWNED: {{testFilesList}}
RUN: {{testRunCmd}}
COMMIT: git -C "{{wt}}" add {{testFilesList}} && {{commitCmd}}
LANE SPEC FILE — the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet's lane_spec_file, not in the packet:
{{laneSpecSlot}}
