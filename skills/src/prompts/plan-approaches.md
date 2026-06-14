Architect. Read the SPEC and propose 2-3 implementation approaches.

SPEC content:
{{specContent}}

Codebase context (CURRENT_STATE.md):
{{currentState}}

For each approach:
- One-sentence strategy description
- Key tradeoffs (speed vs safety, complexity vs flexibility)
- Which existing modules/files it touches most
- Estimated task count and blast radius (low/medium/high)

Return JSON:
{
  "approaches": [
    {
      "name": "approach name",
      "description": "one sentence",
      "tradeoffs": "what you gain / give up",
      "modules_touched": ["file1.py", "file2.py"],
      "estimated_tasks": 3,
      "blast_radius": "low|medium|high"
    }
  ],
  "recommended": 0,
  "recommendation_reason": "why this approach is simplest/safest"
}

Output raw JSON only. No markdown fences.
