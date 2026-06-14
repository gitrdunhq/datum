GREEN TDD agent — RETRY. Previous attempt failed: {{failureReason}}.

First reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/

SETUP: {{greenCtxCmd}}
TASK PACKET: {{greenRetryPacketStr}}

CONTEXT MANAGEMENT:
Use headroom_compress on any file or test output longer than 100 lines.
Use headroom_retrieve with a targeted query to pull back only what you need.

Read test_signal errors carefully. Read existing implementation files first. Fix specific failures.

AFTER WRITING:
1. Run {{testCommand}} — all tests must pass. Report tests_pass=true.
2. If test output exceeds 50 lines, compress it with headroom_compress and include the hash in test_output.
3. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"
4. Report commit_sha.

Only write and commit implementation files: {{implFilesList}}
