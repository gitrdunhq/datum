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
- PROTOCOL COMPLETENESS CHECK (do this for every task before finalizing its `files`): read each acceptance_criteria and ask "does satisfying this AC require adding or changing a method, property, or signature declared on a protocol, an abstract contract, a trait, or a base class?" (e.g. an AC like "use case calls repository.newMethod(...)" implies `newMethod` must be added to wherever the repository's contract is declared, not just its concrete implementation). If yes, search the repo (grep/ast-grep) for the declaration site of that contract/type — the keywords to search for vary by language ("protocol", "trait", "abstract", or the equivalent construct that declares a contract rather than an implementation) — and add that declaring file to `files` alongside the implementation file, since the lane's implementer needs to edit both in the same commit. Do not add it to `reads` in this case; `reads` is for files this task depends on but does not modify, and a contract gaining a new required member IS a modification. If no declaring file exists yet (the contract itself is new), say so in `red_note` instead of inventing a path.
- NO-CODE-CHURN / DOCS-ONLY DETECTION (do this once, before writing any task's `red_note`): read the SPEC content for an NFR-style constraint stating the epic's diff must contain zero files of a given source-code extension, or that the epic is documentation-only/docs-only (e.g. "the diff must contain zero .swift/.py files", "documentation-only epic", "no code churn"). If such a constraint is present, then for every task whose `files[]` includes a test-artifact path that is directory-shaped or otherwise extensionless in a context where the epic's implementation language would normally require a compiled test package for that path (e.g. a Swift Testing target directory like `tests/CpdTableTests`), append this exact instruction to that task's `red_note`: "This epic forbids any file of the forbidden extension(s) in the diff. Write this test artifact as a single extensionless file containing pseudo-code/plain-text assertions — NOT a real compiled test package. Do NOT create a Package.swift, do NOT create a nested Tests/<Target>/ subdirectory, and do NOT add `import XCTest`/`import Testing` or any other compiled-test-framework import." Apply this identically to every affected lane so the constraint is decided once, centrally, at plan time rather than inferred independently per-lane.
- Tasks sharing files must have a dependency edge or be in the same lane
- Each lane MUST have its own unique test file(s). Never assign the same test file to multiple lanes. If multiple tasks target the same module (e.g. `module/foo`), split tests per lane: `tests/test_foo_create`, `tests/test_foo_validate`, etc. This prevents reflect score pollution from cross-lane test accumulation.
- Every task needs: title, acceptance_criteria, files, reads, depends_on, red_note
- ACs must be specific enough to write a failing test from — function names, expected values, exception types
- red_note tells the RED agent what the failing test should prove — use the project's language and test framework, not Python/pytest unless that IS the project language
- depends_on lists task IDs this task requires to be completed first
- reads lists files this task's implementation READS but does NOT modify (e.g. a protocol/contract file another lane owns). If a task reads a file another lane writes, it must either list that file in reads (so a dependency edge is auto-injected) or add an explicit depends_on — otherwise the reader may run before the writer produces that file.

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
    "reads": [],
    "depends_on": [],
    "introduces_stubs": false,
    "red_note": "The failing test must call function_name with input and assert on the return value",
    "estimated_loc": 50
  }
]

Output raw JSON only. No markdown fences.
