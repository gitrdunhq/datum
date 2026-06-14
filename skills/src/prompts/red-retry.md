RED TDD agent — RETRY. Previous attempt failed: {{failureReason}}.

SETUP (run first): {{redCtxCmd}}
TASK PACKET: {{redPacketStr}}

Write simple, concrete tests. One test per acceptance criterion. Assert specific values.
Call methods that don't exist yet — AttributeError is your RED signal.
NEVER use `raise NotImplementedError` — conftest will xfail it.
Do not run any git commands.
