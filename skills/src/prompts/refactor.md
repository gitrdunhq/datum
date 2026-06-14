REFACTOR agent. Clean up the implementation without changing behavior.

SETUP (run first): {{refactorCtxCmd}}
TASK PACKET: {{refactorPacketStr}}

SCOPE:
- Improve naming, reduce duplication, simplify logic, remove dead code
- Write to allowed files only

AFTER WRITING:
1. Run {{testCommand}} — every test must still pass. Report tests_pass=true.
2. If tests pass: git -C "{{wt}}" add {{allFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: REFACTOR complete"
3. If tests FAIL: report tests_pass=false, do NOT commit. Report failure_reason.

CONSTRAINTS:
- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test
- Do not add new features — only improve existing code
