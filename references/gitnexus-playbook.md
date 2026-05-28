# GitNexus Playbook

GitNexus is the impact analysis and code intelligence backbone. The skill calls it at specific points; this doc defines exactly what to call and when.

## Tool Reference

| Tool | Purpose | Returns |
|---|---|---|
| `gitnexus analyze` | Index or reindex the repo | Indexed symbol count, time taken |
| `gitnexus context <symbol>` | What is this symbol, who calls it, what does it depend on | Callers, callees, type info, test coverage |
| `gitnexus impact <symbol_or_file>` | If this changes, what else is affected | Affected symbols, risk level, blast radius |
| `gitnexus detect_changes <diff>` | Assess a diff against the impact graph | Risk level, affected symbols, breaking changes |
| `gitnexus rename <old> <new>` | Coordinated multi-file symbol rename | Changed file list, validation |
| `gitnexus cypher <query>` | Custom graph traversal | Raw query results |
| `gitnexus list_repos` | List indexed repos | Repo list |
| `gitnexus query <text>` | Natural language query of the graph | Matching symbols and context |

## When to Call GitNexus

| Phase | Call | Why |
|---|---|---|
| Bootstrap | `analyze --skills` | One-time per repo indexing |
| Discovery | `query`, `list_repos` | Architecture survey |
| Refine | `context` on docs/epics/$BRANCH/TICKET.md symbols | Verify ticket assumptions |
| Plan | `impact` per change site | Inform lane grouping by blast radius |
| Plan | `cypher` for complex traversals | When `impact` is insufficient |
| Properties | `context` for invariant derivation | What currently calls this |
| Act (pre-flight) | `detect_changes` on planned diff | Risk gate |
| Act (renames) | `rename` | Multi-file coordinated rename |
| Validate | `detect_changes` on full PR diff | Risk-scored validation |
| Review | `impact` per finding | Confirm severity matches blast radius |
| PR Comments | `context` on commented files | Inform triage |
| Closeout | `analyze` | Reindex with post-epic state |

## Calling Pattern

Always pre-fetch GitNexus results at brief-creation time, not during agent execution:
1. Fetch context/impact before constructing the agent's brief
2. Include the relevant excerpts in the brief (not a live call the agent makes mid-run)
3. This makes briefs self-contained and reduces agent round-trips

For ACT phase: fetch context for each task's relevant symbols when building the RED/GREEN/REFACTOR briefs. Update if the task's dependency stubs land and expose new symbols.

## Degraded Mode

When GitNexus is unavailable:

**What degrades:**
- Risk assessment → replaced by heuristic volume threshold
- Caller discovery → grep or AST lane-tools
- Blast radius analysis → unavailable; log `risk_unknown`

**What does NOT change in degraded mode:**
- The skill never claims "low risk" without GitNexus data
- Changes above the heuristic threshold escalate to human approval
- Yolo does not bypass this escalation (degraded mode is the gate)
- State records the degradation: `{ "gitnexus_degraded": true, "degraded_at": "...", "reason": "..." }`

**Heuristic threshold (default):**
- File count delta > 5 files changed → "above threshold"
- LOC delta > 200 lines → "above threshold"
- Either condition triggers escalation

Both conditions must be below threshold to proceed without human approval in degraded mode.

**Logging:**
```json
"gitnexus_degraded_log": {
  "degraded_since": "2026-01-01T12:00:00Z",
  "reason": "MCP server not available in current tool",
  "phases_affected": ["plan", "act", "validate"]
}
```

This is surfaced in the Closeout retro.
