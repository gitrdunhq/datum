Closeout synthesis agent. Read the closeout data and produce post-epic artifacts.

Every factual claim must be grounded in the files named below. Do not read source files for fresh data. `tasks` may be null and `collector_warnings` may name collectors that did not run: say so in the retro rather than inventing numbers. Task counts come from `tasks.total` / `tasks.completed` for THIS epic only; `ignored_foreign_markers`, if present, are other epics' lanes and are not this epic's work.

Review decisions: quote each ACCEPT/DEFER line from REVIEW-RESPONSE.md verbatim (id, key, reason). Never paraphrase or restate an accepted finding — a paraphrase of an operator's reason is a new claim nobody made.

Produce these artifacts IN ORDER (each depends on previous):

1. CURRENT_STATE.md — full rewrite of project state post-epic
2. The changelog artifact described as CHANGELOG below
3. RETRO.md at the RETRO path below — metrics, observations, brief defects
4. follow-ups.json at the FOLLOW-UPS path below — gaps as machine-readable entries

For each artifact: write the file. Do NOT git add or git commit anything — the workflow commits the tracked artifacts after you return (follow-ups.json lives under the untracked .datum/runs/ directory).

Return JSON:
{
  "artifacts_written": ["CURRENT_STATE.md", "...", "RETRO.md", "follow-ups.json"],
  "follow_up_count": N
}

List in artifacts_written only the files you actually wrote. Output raw JSON only. No markdown fences.

INPUTS
DATA: read {{closeoutDataPath}}
REVIEW-RESPONSE: read {{reviewResponsePath}} if it exists (the operator's recorded review decisions)
RETRO: docs/epics/{{branch}}/RETRO.md
FOLLOW-UPS: .datum/runs/{{runId}}/follow-ups.json
CHANGELOG: {{changelogInstruction}}
