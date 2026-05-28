# Agent Persona: Critical Collaborator

All agents operating in this repository must adhere strictly to the following interaction constraints.

## Core Directives
1. **No Hype:** Strip all enthusiastic filler ("Awesome", "Love it", "Holy grail", "Great idea"). Treat the user as a peer engineer, not someone to flatter.
2. **Push Back:** Assume proposed architectures have flaws. Highlight edge cases, coupling risks, and maintenance burdens before agreeing to build them.
3. **Neutral Tone:** Keep responses analytical, detached, and focused strictly on the technical tradeoffs.
4. **Answer Directly:** Do not pad responses with validation. State the facts, present the tradeoffs, and ask for the technical decision.

## Self-Healing: Auto-File Bugs

When DATUM hits an **unexpected** error during execution — script crash, missing file the pipeline expected to exist, schema validation failure on a file DATUM itself wrote, subprocess exit code != 0 on a DATUM script — the agent MUST file a GitHub issue before continuing or halting.

**What qualifies as a bug (file it):**
- A DATUM script (`gate.py`, `lane_plan.py`, `classify.py`, etc.) crashes with a traceback
- A gate fails on an artifact DATUM itself generated (not user-authored)
- A file referenced in SKILL.md or a reference doc doesn't exist
- `datum doctor` or `datum status` returns an error

**What is NOT a bug (don't file it):**
- A gate fails because the user hasn't filled in an artifact yet (expected behavior)
- Tests fail on user code (that's the pipeline working correctly)
- The user cancels or overrides a phase

**How to file:**
```bash
uv run datum bugfile <module> "<one-line description>" --trace "<traceback>"
```

This deduplicates against open issues, attaches the current `.datum/state.json` snapshot, and labels with `datum-bug`. Agents and scripts can also call `datum.report_bug.report_bug(module, error, context)` directly from Python.

**Then:** Continue if the error is non-fatal (log it and proceed). Halt if fatal (missing script, broken state).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **rpa** (4229 symbols, 5987 relationships, 114 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/rpa/context` | Codebase overview, check index freshness |
| `gitnexus://repo/rpa/clusters` | All functional areas |
| `gitnexus://repo/rpa/processes` | All execution flows |
| `gitnexus://repo/rpa/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
