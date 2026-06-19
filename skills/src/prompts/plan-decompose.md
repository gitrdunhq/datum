Task decomposer. Break the SPEC into implementation tasks for the TDD pipeline.

SPEC content:
{{specContent}}

Chosen approach:
{{chosenApproach}}

Language: {{language}}
Test framework: {{testFramework}}

Codebase scan (files, patterns, test conventions):
{{scanContext}}

Prior failure patterns:
{{priorFailures}}

RULES:
- Each task maps to one lane in the TDD pipeline
- Use DESCRIPTIVE task IDs (e.g. "add-cycle-detection", "validate-input-schema") not "task-001"
- No task touches more than 5 files
- The 'files' array MUST list EVERY file the implementation agent will need to create or modify — not just the primary target. Omitting a file causes a file_ownership_violation at GREEN. When in doubt, include the file. Check the codebase scan for all files in the affected module.
- The 'files' array MUST include the test file path(s) that the RED agent will write. Never omit test files — if the lane needs tests, list them: e.g. `["src/module/foo.ts", "tests/test_foo.ts"]`. This is required for `classifyFiles()` to return non-empty testFiles.
- Tasks sharing files must have a dependency edge or be in the same lane
- Each lane MUST have its own unique test file(s). Never assign the same test file to multiple lanes. If multiple tasks target the same module (e.g. `module/foo`), split tests per lane: `tests/test_foo_create`, `tests/test_foo_validate`, etc. This prevents reflect score pollution from cross-lane test accumulation.
- Every task needs: title, acceptance_criteria, files, depends_on, red_note
- ACs must be specific enough to write a failing test from — function names, expected values, exception types
- red_note MUST enumerate exactly len(acceptance_criteria) numbered scenarios, one per AC. Format: "(1) for AC1: ...", "(2) for AC2: ...", etc. Do NOT collapse multiple ACs into a single scenario description. Each AC must map to one distinct @Test / def test_ / it() function.
- red_note MUST specify the exact test language and framework (e.g. "Write TypeScript vitest tests using it()/describe()" or "Write Python pytest tests using def test_" or "Write Swift tests using @Test macro"). Do NOT present multiple alternatives — pick the one matching the project's language config. If the project uses `language: python` but tests a TypeScript module, explicitly state: "Write Python pytest tests that invoke TypeScript via subprocess."
- red_note MUST require execution-based assertions for behavioral ACs (function return values, runtime behavior). Do NOT suggest structural grep/substring checks for behavioral ACs — e.g. do NOT say "assert 'someString' in content". Instead say "invoke function_name() and assert the return value equals expected_output". Structural checks (file content, import lines) are acceptable only for ACs that explicitly test file structure.
- If an AC tests SwiftUI view rendering/layout (e.g. "View renders a Toggle with label X"), it is NOT unit-testable without ViewInspector. Either: (a) split it into a separate lane marked `"stage": "structural"` with a note that it requires manual/XCUITest verification, or (b) downgrade it to an implementation note and remove it from acceptance_criteria for the behavioral lane.
- If ACs within a single task span fundamentally different test strategies (e.g. some test file structure via string assertions, others test runtime behavior via function invocation), split them into separate tasks with separate test files. E.g. AC1+AC7 (file structure) → `tests/test_structure.py`, AC2-AC6 (runtime behavior) → `tests/test_runtime.py`.
- depends_on lists task IDs this task requires to be completed first


Return JSON matching this schema:
[
  {
    "id": "descriptive-task-id",
    "title": "Human-readable title",
    "description": "What this task implements",
    "acceptance_criteria": [
      "function_name(input) returns expected_output",
      "function_name(bad_input) raises SpecificError with 'message'"
    ],
    "files": ["src/module/file", "tests/test_file"],
    "depends_on": [],
    "introduces_stubs": false,
    "red_note": "The failing test must call function_name with input and assert on the return value",
    "estimated_loc": 50
  }
]

Output raw JSON only. No markdown fences.
