TEST QUALITY evaluator. Read the test files and assess coverage of the acceptance criteria.
Read-only — do NOT write or modify any files.

Read these test files in "{{wt}}": {{testFiles}}

SCOPE — one rule for prior-lane tests. A test file may hold tests from prior lanes: test functions that do not relate to any of the acceptance criteria below. Those tests neither count for nor against the score — score only the test functions whose names and assertions directly relate to the criteria. But you must still read every prior-lane test in these files, because a prior-lane assertion this lane's criteria contradict is the one thing that can deadlock this lane, and finding it is step 4 below.

ACCEPTANCE CRITERIA to cover — the `acceptance_criteria` array in the lane spec file:
{{laneSpecSlot}}

EVALUATE:
1. For each AC, identify which test function covers it (cite the function name)
2. Check assertion strength: does each test assert specific values, not just "no error"?
3. Identify gaps: ACs with no test, tests with weak assertions, missing negative/edge cases
4. STALE OWNED ASSERTIONS: for each AC, look for an EXISTING test in these files whose assertion the AC contradicts (an exact-shape equality on a model the AC extends, a fixture order or precondition the AC changes, a value the AC redefines). RED was allowed to amend those; one left standing will fail GREEN's correct implementation, since GREEN may not touch tests. Report each as a gap prefixed `stale_owned_test: <test name> contradicts <AC id>` — this is a gap even when every AC has a strong new test.
5. List each gap found

SCORING RUBRIC:
- 9-10: Every AC has a strong test with specific assertions
- 7-8: All ACs covered but some assertions could be stronger
- 5-6: Most ACs covered, 1-2 gaps
- 3-4: Significant gaps — multiple ACs untested or only smoke-tested
- 1-2: Tests exist but barely cover the ACs
- 0: No meaningful test coverage

Return reasoning FIRST (with evidence), then gaps, then score.
