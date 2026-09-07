---
spec_id: SPEC-0001
title: Stable epic identity, independent of branch name
status: draft
---

# Stable epic identity, independent of branch name

## Objective
Replace datum's branch-name-derived epic identity with a stable, independent epic ID stored in a new per-checkout .datum/epic.json. Epic directories move from docs/epics/<branch>/ to docs/epics/<epic-id>/, and .datum/pipeline-state.json is scoped by epic ID instead of branch name. This closes the root cause behind three real bugs found dogfooding datum-go end-to-end on 2026-09-03: stale pipeline-state trusted across unrelated epics, branch-name collisions (e.g. datum/epic-1), and epic state getting orphaned by a branch rename or switch.

## Assumptions
- A1: The epic ID is not exposed anywhere user-visible beyond `datum status --json` in this pass (no change to commit message format or PR titles). Default applied: Purely internal bookkeeping for now; user asked to keep scope tight to identity + directory layout, did not raise commit/PR stamping.
- A2: Only one epic can be in progress per checkout at a time (matches current single .datum/pipeline-state.json / single checked-out branch model) — epic.json is a single object, not a list. Default applied: No signal from the user that multi-epic-per-checkout is in scope; existing pipeline-state.json is already single-object.
- A3: The migration command is named `datum init --migrate-epic-id` and operates on the epic for the currently checked-out branch only (one epic per invocation), not a repo-wide bulk migration across all branches. Default applied: User confirmed an explicit migration command is required but did not specify its exact name or scope; `datum init --migrate-epic-id` was the name proposed during the interview and not contested.
- A4: Existing hardcoded docs/epics/${branch} path construction in phase scripts (datum-go.ts, datum-refine.ts, datum-plan.ts, datum-properties.ts, datum-tdd-act*.ts) is replaced with docs/epics/${epicId}, resolved via .datum/epic.json rather than the branch. Default applied: Direct consequence of the chosen directory-rename option; not separately asked since it follows mechanically.

## Requirements
| ID | Priority | Criterion |
|----|----------|-----------|
| R-001 | MUST | The first `datum init` or `datum go` run on a branch with no existing .datum/epic.json and no TICKET.md writes .datum/epic.json. |
| R-002 | MUST | .datum/epic.json contains at minimum an id field, a branch field, and a createdAt timestamp field. |
| R-003 | MUST | The id field is a short LLM-derived kebab-case slug with a random uniqueness suffix appended, for example wire-deterministic-scanner-a3f1. |
| R-004 | MUST | For any epic bootstrapped after this change ships, the epic's working files (TICKET.md, SPEC.md, TASKS.md, lane-plan.json, and every other epic-scoped artifact) live at docs/epics/<epic-id>/, not docs/epics/<branch>/. |
| R-005 | MUST | Every phase script that currently constructs docs/epics/${branch} (skills/src/datum-go.ts, datum-refine.ts, datum-plan.ts, datum-properties.ts, datum-tdd-act*.ts) resolves the epic directory from .datum/epic.json's id field instead of the branch name. |
| R-006 | MUST | .datum/pipeline-state.json includes the epic id it belongs to. |
| R-007 | MUST | datum-go's stale-state guard (isStaleState) compares the current .datum/epic.json id against pipeline-state.json's stored epic id, not the branch name. |
| R-008 | MUST | Renaming the current branch with git branch -m does not orphan or invalidate the epic's state, because epic identity is read from .datum/epic.json rather than derived from the branch name at each check. |
| R-009 | MUST | Checking out a different branch and returning to the epic's branch does not orphan or invalidate the epic's state, for the same reason. |
| R-010 | MUST | An epic bootstrapped before this change ships — a directory at docs/epics/<branch>/ with no corresponding .datum/epic.json — continues to be usable by datum go, datum status, and datum init exactly as it worked before this change, without requiring migration to proceed. |
| R-011 | MUST | datum init --migrate-epic-id, run with a legacy epic's branch checked out, generates a new epic ID for that epic. |
| R-012 | MUST | datum init --migrate-epic-id moves docs/epics/<branch>/ to docs/epics/<epic-id>/ using git mv, so file history and blame follow the move. |
| R-013 | MUST | datum init --migrate-epic-id writes .datum/epic.json for the migrated epic once the move completes. |
| R-014 | MUST | datum init --migrate-epic-id refuses to run and exits non-zero, naming the conflicting path, when docs/epics/<epic-id>/ already exists at the target path — it makes no filesystem changes in that case. |
| R-015 | MUST | .datum/epic.json is gitignored, matching the existing .datum/pipeline-state.json convention of per-checkout local state that is not committed. |
| R-016 | SHOULD | The hook scripts referenced by .claude/agents/datum-*.md that construct epic-scoped paths resolve the epic directory the same way the phase scripts do, via .datum/epic.json, so lane-file-guard and protect-tests continue to work against the new directory layout. |
| R-017 | WON'T | The epic ID is not exposed in commit messages, PR titles, or any user-facing text other than datum status --json output, in this pass. |

## Won't
- W-001: Multi-epic-per-checkout support (running more than one epic concurrently against a single working tree) is out of scope; epic.json remains a single object.
- W-002: Repo-wide bulk migration of every branch-named epic in a repo's history in one command is out of scope; migration is one epic (the currently checked-out one) per `datum init --migrate-epic-id` invocation.
- W-003: Changing how the epic ID's slug portion is worded/styled (still an LLM-derived kebab-case slug, same quality bar as today's branch slugs) is out of scope — only the uniqueness suffix and its storage location are new.

## Notes
Produced from an interview run against skills/src/datum-go.ts, datum-refine.ts and datum/agents_materialize.py context gathered while dogfooding datum-go end-to-end on 2026-09-03 (see project memory project_datum_dogfooding_524.md and project_epic_identity_redesign.md in the session's memory store). Three real bugs motivated this spec: stale .datum/pipeline-state.json trusted across unrelated epics (patched symptomatically in commit 7ca816c via isStaleState() comparing branch names — this spec supersedes that comparison with an epic-id comparison per R-007), generic auto-generated branch names colliding across epics, and no epic-identity representation independent of the currently checked-out branch. No ambiguity class outside the existing list was needed for this interview.
