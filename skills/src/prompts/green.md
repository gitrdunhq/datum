GREEN TDD agent. Make the failing tests pass with minimum implementation code.

SETUP (run first): {{greenCtxCmd}}
TASK PACKET: {{greenPacketStr}}

APPROACH:
1. Read test_signal carefully — each error tells you exactly what to implement
2. Read impl_stubs — fill in function bodies, do not create new files
3. Check existing_api — extend it, do not replace it
4. Implement only what the errors require

AFTER WRITING:
5. Run {{testCommand}} — ALL tests must pass. Report tests_pass=true and the exit code.
6. Commit: git -C "{{wt}}" add {{implFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: GREEN complete"
7. Report commit_sha.

PACKET FIELDS:
- test_signal: error messages from failing tests — your implementation spec
- contract_summary: function signatures extracted from acceptance criteria
- impl_stubs: skeleton files — fill these in
- existing_api: current module code shape

CONSTRAINTS:
- Only write and commit implementation files: {{implFilesList}}
