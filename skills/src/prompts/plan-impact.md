Impact analyzer. For each module/file the SPEC will change, assess blast radius.

Working directory: {{wt}}
Files to analyze:
{{filesList}}

TOOLS (use in preference order):
1. `ast-grep --pattern '<function_name>($$$)' .` — find all callers structurally
2. `scc --no-cocomo <file>` — LOC and complexity for a specific file
3. GitNexus (gitnexus_impact) if available
4. grep as fallback

For each file:
1. Use ast-grep to find all callers/importers (structural, not string match)
2. Run `scc --no-cocomo <file>` to get LOC and complexity
3. Check if it's covered by existing tests (ast-grep for test functions referencing it)
4. Assess risk from caller count + complexity

Return JSON:
{
  "files": [
    {
      "path": "module/file.py",
      "loc": 150,
      "callers": ["other/module.py", "cli.py"],
      "caller_count": 2,
      "has_tests": true,
      "test_files": ["tests/test_file.py"],
      "risk": "low|medium|high",
      "notes": "why this risk level"
    }
  ],
  "high_risk_files": ["files with risk=high that need isolated lanes"]
}

Output raw JSON only. No markdown fences.
