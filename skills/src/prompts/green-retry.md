GREEN TDD agent — RETRY. Previous attempt failed: {{failureReason}}.

First reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/

SETUP: {{greenCtxCmd}}
TASK PACKET: {{greenRetryPacketStr}}

LANE SPEC FILE — the acceptance_criteria, red_note and contract_summary for this task are in the file named by the packet's lane_spec_file, not in the packet:
{{laneSpecSlot}}

Read test_signal errors carefully. Read existing implementation files first. Fix specific failures.

AFTER WRITING:
1. Run the suite with exactly: {{testRunCmd}}
   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code — never pipe the test command into tail or grep, a pipe masks the exit code). All tests must pass (TEST_EXIT=0). Report tests_pass and test_exit_code.
2. Commit: git -C "{{wt}}" add {{implFilesList}} && {{commitCmd}}
   Use that exact commit command (datum author identity + Datum-* trailers); do not change the subject or author.
3. Report commit_sha.

Only write and commit implementation files: {{implFilesList}}
- Never edit, delete or `git add` a test file, and never `git commit --amend` or rewrite the RED commit: a GREEN commit whose diff touches a test file fails the lane as green_edited_tests. If a test is wrong, report it in failure_reason instead of changing it.
If the tests cannot pass without writing a file outside that list, do NOT write it — return {"success": false, "tests_pass": false, "committed": false, "status": "blocked", "needs_write": ["<paths>"], "reason": "<why>"} instead.
