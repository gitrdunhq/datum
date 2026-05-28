# Enhancement: Auto-generate walkthrough.md summaries

**Issue:** #45
**Labels:** enhancement
**Author:** sam-fakhreddine

## Request

Enhance Datum to automatically generate a `walkthrough.md` summary artifact after completing a pipeline phase or an epic.

Currently, agents manually generate these walkthroughs to summarize what was achieved (e.g., schemas updated, architecture changes like the ACI execution loop, and configuration controls added).

## Implementation Note

We already have a robust template system in `templates/`. We should add a new `WALKTHROUGH.md` template to this directory. Datum should use this template to automatically compile these changes into a clean post-mortem artifact, rather than hardcoding the markdown generation in the agent's logic.

## Expected Outcome

- A `WALKTHROUGH.md` template exists in `templates/`
- The `datum closeout` command (or a new `datum walkthrough` sub-command) generates a populated walkthrough artifact from the current epic's artifacts
- The generated walkthrough is stored at `docs/epics/<branch>/WALKTHROUGH.md`
- The generation uses local LLM (Gemma) to summarize changes intelligently from git diff, SPEC.md, and TASKS.md
