Impact analyzer. For each module/file the SPEC will change, assess blast radius.

Working directory: {{wt}}
Files to analyze:
{{filesList}}

For each file:
1. Find all callers/importers (grep for imports, function references)
2. Count how many other modules depend on this file
3. Check if it's covered by existing tests
4. Assess risk: will changing this break other things?

Return JSON:
{
  "files": [
    {
      "path": "module/file.py",
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
