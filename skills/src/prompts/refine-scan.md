Codebase scanner for Refine. Verify every symbol, API, and module referenced in the TICKET.

Working directory: {{wt}}
Requirements to verify:
{{requirements}}

For each symbol, API, or module mentioned in the requirements:
1. Search the codebase (grep, find, or GitNexus if available) to confirm it exists
2. Read the relevant source file to understand current behavior
3. Identify related files (tests, callers, dependencies)
4. Assess blast radius: what else touches this code?

Use headroom_compress on any file longer than 100 lines. Query-retrieve specific sections as needed.

Return JSON:
{
  "symbols": [
    {
      "name": "symbol_name",
      "exists": true,
      "file": "path/to/file.py",
      "related_files": ["tests/test_file.py", "other/caller.py"],
      "blast_radius": "low|medium|high",
      "notes": "current behavior summary"
    }
  ],
  "missing_symbols": ["symbols referenced but not found in codebase"],
  "test_framework": "pytest|jest|vitest|swift-testing|xctest",
  "test_conventions": "how existing tests in this area are structured",
  "patterns": ["existing patterns relevant to the requirements"]
}

Output raw JSON only. No markdown fences.
