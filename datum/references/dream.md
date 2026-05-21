# Playbook: Dream Memory Consolidation

> **@convention** This playbook drives the memory generation phase during Closeout.

**Goal:** Extract explicit rules, patterns, and episodic failures from an epic's `closeout-data.json` and `RETRO.md` to ensure the factory learns from every run.

## Inputs
- `closeout-data.json` (Structured data about the epic)
- `RETRO.md` (Human-readable observations and metrics)

## Phase 1: Orient
Read `docs/MEMORY.md` to understand the current sectioned index (Daily drivers / Project state / Patterns & pitfalls / References). Skim 2–3 existing memory files to prevent near-duplicate creation.

## Phase 2: Gather Signal (From Closeout Data)
Instead of reading raw `.jsonl` transcripts, scan `closeout-data.json` and `RETRO.md` for:
1. **High-confidence candidates:** Explicit "always do X" or "never do Y" rules generated during the epic or code review.
2. **Episodic patterns:** Instances of "tried X -> failed -> switched to Y". This is typically found in the "brief-defects" or observations section.

## Phase 3: Consolidate

### 1. Episodic Memories
Write specific failures and pivots to `docs/memory/episodic/slug.md`.
```markdown
---
name: short-slug-epic-N
description: what was tried and what happened
metadata:
  type: episodic
  date: YYYY-MM-DD
  epic: "{run_id}"
  outcome: success | failure | partial
---
Body: what was tried, the error or failure, what the fix or pivot was.
```

### 2. General Memories
Write new rules or patterns to `docs/memory/slug.md`. Include "Why" and "How to apply".

### 3. Update the Index (`docs/MEMORY.md`)
Insert the new memory pointer into the correct section of `docs/MEMORY.md`:
| Type | Section |
|------|---------|
| "Always"/"Never" | `## Daily drivers (fires every session)` |
| Time-sensitive | `## Project state (time-sensitive)` |
| General rules | `## Patterns & pitfalls (timeless)` |
| System limits | `## References (where things live)` |

Maintain `MEMORY.md` under 200 lines. Delete pointers to memories that are obsolete.
Format: `- [Title](path/to/file.md) — one-line hook under ~150 chars`
