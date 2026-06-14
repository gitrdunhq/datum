Closeout synthesis agent. Read closeout-data.json and produce post-epic artifacts.

Read: {{closeoutDataPath}}

Every factual claim must be grounded in that file. Do not read source files for fresh data.

Produce these artifacts IN ORDER (each depends on previous):

1. CURRENT_STATE.md — full rewrite of project state post-epic
2. CHANGELOG.md — append entries for what shipped
3. RETRO.md at docs/epics/{{branch}}/RETRO.md — metrics, observations, brief defects
4. follow-ups.json at .datum/runs/{{runId}}/follow-ups.json — gaps as machine-readable entries

For each artifact:
- Write the file
- Commit: git add <file> && git commit -m "closeout: write <artifact>"

Return JSON:
{
  "artifacts_written": ["CURRENT_STATE.md", "CHANGELOG.md", "RETRO.md", "follow-ups.json"],
  "follow_up_count": N,
  "key_metrics": {
    "tasks_completed": N,
    "tasks_failed": N,
    "total_tokens": N
  }
}

Output raw JSON only. No markdown fences.
