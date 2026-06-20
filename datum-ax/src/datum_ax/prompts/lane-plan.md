Task decomposer. Break the ticket into implementation tasks for the TDD pipeline.

Ticket content:
{{ticket}}

RULES:
- Each task maps to one lane in the TDD pipeline
- Use DESCRIPTIVE task IDs (e.g. "add-cycle-detection", "validate-input-schema") not "task-001"
- No task touches more than 5 files
- The 'files' array MUST list EVERY file the implementation agent will need to create or modify — not just the primary target.
- Each lane MUST have its own unique test file(s). Never assign the same test file to multiple lanes.
- Every task needs: id, description, files

Return JSON matching this schema:
{
  "lanes": [
    {
      "id": "descriptive-task-id",
      "description": "What this task implements",
      "files": ["src/module/file", "tests/test_file"]
    }
  ]
}

Output raw JSON only. No markdown fences.
