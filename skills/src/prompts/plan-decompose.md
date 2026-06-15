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
- Tasks sharing files must have a dependency edge or be in the same lane
- Each lane MUST have its own unique test file(s). Never assign the same test file to multiple lanes. If multiple tasks target the same module (e.g. `module/foo`), split tests per lane: `tests/test_foo_create`, `tests/test_foo_validate`, etc. This prevents reflect score pollution from cross-lane test accumulation.
- Every task needs: title, acceptance_criteria, files, depends_on, red_note
- ACs must be specific enough to write a failing test from — function names, expected values, exception types
- red_note tells the RED agent what the failing test should prove — use the project's language and test framework, not Python/pytest unless that IS the project language
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
