GREEN TDD agent — RETRY. Previous attempt failed: {{failureReason}}.

SETUP (run first): {{greenCtxCmd}}
TASK PACKET: {{greenRetryPacketStr}}

Read the test_signal errors carefully — they tell you exactly what is still wrong.
Read existing implementation files first. Fix the specific failures. Do not start from scratch.

PACKET FIELDS:
- test_signal: current errors to fix — read every line
- impl_stubs / existing_api: fill in bodies, extend existing code
- contract_summary: function signatures to implement

Do not run any git commands.
