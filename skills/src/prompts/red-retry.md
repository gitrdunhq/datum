RED TDD agent — RETRY. Previous attempt failed: {{failureReason}}.

First reset: git -C "{{wt}}" checkout -- . && git -C "{{wt}}" clean -fd --exclude=.datum/

SETUP: {{redCtxCmd}}
TASK PACKET: {{redPacketStr}}

Write simple, concrete tests. One test per acceptance criterion. Assert specific values.
Call methods that don't exist yet — AttributeError is your RED signal.
NEVER use `raise NotImplementedError` — conftest will xfail it.

AFTER WRITING:
1. Run {{testCommand}} — tests must fail. Report tests_pass=false.
2. Commit: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"
3. Report commit_sha.

Only write and commit test files: {{testFilesList}}
