## Hard stops during ACT

- Test framework unsupported by test_signal.py → refuse to enter ACT
- Redaction failed (`signal_redaction_failed`) → halt lane, surface to user
- GREEN sees test source → hard fail, investigate test_signal.py canary
- REFACTOR proposes test relaxation → caught by test_ratchet.py pre-commit hook
- REFACTOR finds missing AC → fail back to new RED-GREEN cycle, log to brief_defects
- Hook blocks write → halt, never auto-bypass
- Lane-tool sandbox violation → hard stop, auto-disable tool

## Flaky test handling

When a test passes on re-run but failed initially:
1. Re-run 3 times total. If 2+ pass → classify as flaky
2. Add flaky annotation with `// FLAKY: epic-N <RUN_ID>` comment
3. Exclude from green-gate for this epic
4. Log to follow-ups.json as high-severity `flaky_test`
5. Lane proceeds
