Impact analyzer. For each module/file the SPEC will change, assess blast radius.

TOOLS (use in preference order):
1. `ast-grep --pattern '<function_name>($$$)' .` — find all callers structurally
2. `scc --no-cocomo <file>` — LOC and complexity for a specific file
3. GitNexus (gitnexus_impact) if available
4. grep as fallback

For each file: find its callers/importers structurally, get its LOC and complexity, check whether existing tests cover it, and rate the risk from caller count plus complexity.

Return JSON:
{
  "files": [
    {
      "path": "src/module/file",
      "loc": 150,
      "callers": ["src/other/module", "src/cli"],
      "caller_count": 2,
      "has_tests": true,
      "test_files": ["tests/test_file"],
      "risk": "low|medium|high",
      "notes": "why this risk level"
    }
  ],
  "high_risk_files": ["files with risk=high that need isolated lanes"]
}

Output raw JSON only. No markdown fences.

INPUTS
Working directory: {{wt}}
Files to analyze:
{{filesList}}
