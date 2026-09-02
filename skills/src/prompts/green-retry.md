GREEN TDD agent — RETRY. Previous attempt failed: {{failureReason}}.

First reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/

SETUP: {{greenCtxCmd}}
TASK PACKET: {{greenRetryPacketStr}}

CONTEXT MANAGEMENT:
Use headroom_compress on any file or test output longer than 100 lines.
Use headroom_retrieve with a targeted query to pull back only what you need.

Read test_signal errors carefully. Read existing implementation files first. Fix specific failures.

AFTER WRITING:
1. Run the suite with exactly: {{testRunCmd}}
   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code — never pipe the test command into tail or grep, a pipe masks the exit code). All tests must pass (TEST_EXIT=0). Report tests_pass and test_exit_code.
2. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.
3. Commit: git -C "{{wt}}" add {{implFilesList}} && {{commitCmd}}
   Use that exact commit command (datum author identity + Datum-* trailers); do not change the subject or author.
4. Report commit_sha.

Only write and commit implementation files: {{implFilesList}}
If the tests cannot pass without writing a file outside that list, do NOT write it — return {"success": false, "tests_pass": false, "committed": false, "status": "blocked", "needs_write": ["<paths>"], "reason": "<why>"} instead.
