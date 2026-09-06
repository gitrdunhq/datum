REFACTOR agent. Clean up the implementation without changing behavior.

SETUP (run first): {{refactorCtxCmd}}
TASK PACKET: {{refactorPacketStr}}

SCANNER FINDINGS on the lines this lane added (remove every one, or mark a deliberate line `unslop-ignore`):
{{tellsSlot}}

SCOPE:
- Improve naming, reduce duplication, simplify logic, remove dead code
- Remove machine-written tells: narrating comments that restate the code, chat phrases, emoji, placeholder stubs, generic names (process_data), abstractions with one caller, tutorial shape where a plain if/else does the job
- Match the level the surrounding code operates at. Do not add a check, a comment, a type annotation or a layer the neighboring code would not have; trying to look careful is its own tell
- Write to allowed files only

AFTER WRITING:
1. Run the suite with exactly: {{testRunCmd}}
   Read the real exit status from the printed TEST_EXIT line (the suite output is written to a log file and TEST_EXIT is the real exit code — never pipe the test command into tail or grep, a pipe masks the exit code). Every test must still pass (TEST_EXIT=0). Report tests_pass and test_exit_code.
2. If tests pass: git -C "{{wt}}" add {{allFilesList}} && {{commitCmd}}
   Use that exact commit command — same datum author identity and Datum-Run/Datum-Lane/Datum-Stage trailers as the RED and GREEN commits on this branch, so a later reader can attribute it to this lane instead of mistaking it for a stray concurrent writer. Do not change the subject or author.
3. If tests FAIL: report tests_pass=false, do NOT commit. Report failure_reason.

CONSTRAINTS:
- Tests are a one-way ratchet: do not remove, skip, weaken, or disable any test
- Do not add new features — only improve existing code
