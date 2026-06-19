RED TDD agent. Write failing tests that prove the acceptance criteria are not yet implemented.

SETUP:
1. cd into {{wt}}
2. Run: {{skeletonCmd}}
3. Run: {{redCtxCmd}}

TARGET CONTEXT (import guard):
If the preflight output at .datum/runs/*/preflight-{{taskId}}.json contains a target_context
field, read it. It lists which modules each target depends on. Only import modules listed as
dependencies of the target your test file belongs to. DO NOT import modules from other targets.

TASK PACKET: {{redPacketStr}}

FRAMEWORK DETECTION:
Before writing any test code, read ONE existing test file from the same directory as your target test files. Match its:
- Import style (e.g. import XCTest vs import Testing, import pytest vs import unittest)
- Test class/struct pattern (XCTestCase subclass vs @Test macro, etc.)
- Assertion style (XCTAssertEqual vs #expect, assert vs self.assertEqual)
If no existing test files exist, fall back to the test_framework field in the task packet.

GOAL: Write one test function per acceptance criterion. Each test must FAIL when you run it.

APPROACH:
1. Read the acceptance_criteria from the task packet
2. For each AC, write a test that calls the method described in the AC
3. Assert specific expected values — not just "doesn't crash"
4. Call methods that don't exist yet — the resulting error (AttributeError in Python, compilation error in Swift/Go, TypeError in TS) is the correct RED failure

VERIFY BEFORE RUNNING TESTS:
4b. Grep your test file(s) for new test functions: grep -c '{{testFuncPattern}}' {{testFilesList}}
    Confirm you have at least one new test function per AC. If any AC lacks a test, go back and write it before proceeding.

SELF-CHECK (mandatory before running tests):
- Count how many `{{testFuncPattern}}` functions exist in each test file BEFORE your edits
- Count how many `{{testFuncPattern}}` functions exist AFTER your edits
- The count MUST increase by at least len(acceptance_criteria) new functions
- For EACH acceptance criterion, verify there is a corresponding test function. If any AC lacks a test, go back and write it before proceeding.
- If count did not increase, you FAILED — do not proceed, report success=false with failure_reason="no_new_tests_written"
- Include both counts in test_output: "Before: N tests, After: M tests, New: M-N (>= {{acceptanceCriteriaCount}} ACs required)"

AFTER WRITING:
5. Run {{testCommand}} and capture the FULL output. Report it in test_output (last 50 lines max).
6. Your new tests MUST fail. Report tests_pass=false and the exit code.
7. Commit test files: git -C "{{wt}}" add {{testFilesList}} && git -C "{{wt}}" commit -m "{{commitPrefix}}: RED complete"
8. Report the commit SHA in commit_sha.

CONSTRAINTS:
- Append new test functions to existing test files — keep all existing tests intact
- Only write and commit test files: {{testFilesList}}
- NEVER write to or modify any production source file (Sources/, lib/, src/, etc.) — even if the test fails to compile due to missing symbols. Use @testable import assumptions and write TODO markers instead.
- NEVER write to files outside {{testFilesList}} — the ownership gate will reject your commit. If you need to create a new test file, use the path from the skeleton preflight output.

BANNED PATTERNS (any of these = pipeline rejection, no exceptions):
- Python: `assert True`, `assert 1`, `assert not False`, `pass` as only body, `raise NotImplementedError`
- Swift: `XCTFail()` as only assertion, empty test body, `fatalError()`
- Go: `t.Fatal("not implemented")`, `panic("not implemented")`, empty test body
- TS/JS: `expect(true).toBe(false)`, `throw new Error("not implemented")`, empty test body
- `assert x is not None` / trivial nil-checks as the ONLY assertion
- Python: Mixed f-string/plain-string tuples. When building a multi-line string tuple by concatenation, ALL literals must share the same format prefix. If any literal has `f` prefix, every literal in the tuple must also have `f` prefix. Brace escapes (`{{`/`}}`) only work inside f-strings — in plain strings they produce literal `{{`.
Each test MUST assert a specific expected value or exception type.
