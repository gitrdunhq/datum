Task decomposer. Break the SPEC into implementation tasks for the TDD pipeline.

SPEC content:
{{specContent}}

Chosen approach:
{{chosenApproach}}

Codebase scan (files, patterns, test conventions):
{{scanContext}}

Prior failure patterns:
{{priorFailures}}

RULES:
- Each task maps to one lane in the TDD pipeline
- Use DESCRIPTIVE task IDs (e.g. "add-cycle-detection", "validate-input-schema") not "task-001"
- No task touches more than 5 files
- Tasks sharing files must have a dependency edge or be in the same lane
- Every task needs: title, acceptance_criteria, files, depends_on, red_note
- ACs must be specific enough to write a failing test from — function names, expected values, exception types
- red_note tells the RED agent what the failing test should prove
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
    "files": ["module/file.py", "tests/test_file.py"],
    "depends_on": [],
    "introduces_stubs": false,
    "red_note": "The failing test must call function_name with input and assert on the return value",
    "estimated_loc": 50
  }
]

Output raw JSON only. No markdown fences.
