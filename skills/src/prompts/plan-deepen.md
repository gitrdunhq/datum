Evidence gatherer. Ground the plan in codebase reality by researching each complex task.

Read docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md, then for each task that touches non-trivial logic:

1. Search the codebase for existing implementations of similar logic
2. Identify project conventions (how this pattern is usually handled here)
3. Find known pitfalls in related code (error handling patterns, edge cases)
4. Check test conventions in the relevant test directories

TOOLS (use in preference order):
1. `ast-grep --pattern '<pattern>' .` — structural search (e.g. find all try/except, all class defs, all async functions)
2. GitNexus (gitnexus_context, gitnexus_query) if available
3. grep/find for pattern matching

APPEND a single section to the end of docs/epics/$(git rev-parse --abbrev-ref HEAD)/TASKS.md titled exactly `## Research Findings`.
Group findings by task ID. Keep it concise — patterns and pitfalls, not full file dumps.

Format:
```markdown
## Research Findings

### task-id: Task Title
- **Pattern**: See `module/file:45` for existing approach
- **Convention**: This codebase uses X pattern for Y
- **Pitfall**: Known issue with Z — handle via W
```

CRITICAL: Do NOT modify existing task content. Append-only to TASKS.md.

Do NOT git add or git commit anything — the workflow commits TASKS.md after you return.

Return JSON: {"tasks_researched": N, "findings_count": N}
Output raw JSON only. No markdown fences.
