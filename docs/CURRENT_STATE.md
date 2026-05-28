# Current State

**Last updated:** May 2026
**Epic:** DATUM V2 Modernization & Migration

---

## What shipped

- **MCP Router Proxy Integration**: Transitioned all agent tool provisioning to a 1-to-Many architecture (`mcp-router`). Implemented `datum mcp sync` to instantly purge scattered `mcpServers` configs from Cursor, Claude CLI, Claude Desktop, Gemini, Kiro, and Codex, safely routing them all through the unified proxy endpoint.
- **Repository Restructuring (`src/` layout)**: Safely migrated the orchestrator codebase from `datum/` into `src/datum/`. The root is now isolated and acts purely as a standard workspace for the DATUM pipeline, keeping internal Python config out of the project context.
- **Pydantic Data Models**: Executed a massive technical debt purge. Deleted 22 raw `.schema.json` files and ripped out the custom manual JSON validator in `contracts.py`. Fully transitioned the core state machine, briefs, results, and packets to strongly-typed Pydantic `BaseModel` classes, ensuring immediate validation and full IDE autocomplete.

## Active work / Next Steps

- **V4 "Teach" Phase Implementation**: Rework `datum-teach` to fit the modernized V2 architecture.
- **Fleet Command**: Implement centralized control across multiple machines (Dual Mode / Headless).
- **Assimilate Legacy Integrations**:
  - Update Triage/Discovery to use `jira-intake` standards.
  - Convert `oncallguy-daily-report` into `scripts/factory_report.py`.
- **GitNexus Auto-Reindexing**: Automate re-indexing via `scripts/closeout/gitnexus_reindex.py` upon PR merge.

## Known issues

- (None immediately blocking. The new Pydantic schema validation runs 100% clean on legacy fixture tests).

## Architecture notes

- **Tool Configuration**: Do NOT hardcode tools into IDE files manually. Always instruct the user to use the `mcp-router` GUI and use `datum mcp sync` if agent environments drift.
- **State Validation**: Treat `src/datum/models/` as the single source of truth for contract data. Do not revert to raw JSON schema files.
- **Layout**: DATUM source code lives in `src/datum/`. The `AGENTS.md` at the repository root governs the *pipeline execution* persona (Critical Collaborator), not the source code rules.
