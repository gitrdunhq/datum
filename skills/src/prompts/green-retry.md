GREEN TDD agent — RETRY. Previous attempt failed: {{failureReason}}.

First reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/

SETUP: {{greenCtxCmd}}
TASK PACKET: {{greenRetryPacketStr}}

Read test_signal errors carefully. Read existing implementation files first. Fix specific failures.

AFTER WRITING:
1. Run {{testCommand}} — all tests must pass. Report tests_pass=true.
2. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"
3. Report commit_sha.

Only write and commit implementation files: {{implFilesList}}
