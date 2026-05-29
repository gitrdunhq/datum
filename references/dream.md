# Playbook: Dream Memory Consolidation

> **@convention** This playbook drives the memory generation phase during Closeout and can be invoked standalone via `datum dream`.

**Goal:** Extract rules, patterns, and episodic failures from the current epic to ensure the factory learns from every run.

## CLI

```bash
datum dream                # full pass: audit + extract + report
datum dream --audit-only   # staleness audit only
datum dream --extract-only # transcript extraction only
```

## Phase 0 — Staleness Audit

`datum dream` runs `datum.memory_audit.audit_directory()` on the project memory dir. Flags project/reference memories that exceed their `expires_after_days` without a recent `last_verified` date.

Actions:
- `verify` — expired but recent; confirm it's still accurate
- `archive` — significantly past expiry; move to `{memory_dir}/archive/`

## Phase 1 — Orient

Read `MEMORY.md` to understand the sectioned index. Skim existing topic files to prevent near-duplicate creation.

## Phase 2 — Gather Signal

`datum dream` runs `datum.memory_extract._extract_from_transcript()` on the 2 newest session transcripts. Extracts candidates in three confidence tiers:

**High-confidence** (explicit "remember X" / "always do Y" / "never do Z"):
- Auto-write as memories without asking.

**Medium-confidence** (corrections, "we should", "actually"):
- Present to user for confirmation.

**Low-confidence**: skip unless user asks.

Also scan for episodic patterns: tried X → error → switched to Y. Write as episodic memories to `{memory_dir}/episodic/`.

## Phase 3 — Consolidate

Write or update memory files with proper frontmatter:

```yaml
---
name: short-kebab-case-slug
description: one-line summary
metadata:
  type: user | feedback | project | reference | episodic
  scope: global | project
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  epic: chore/arch-debt-1  # or PR #311 (optional)
  issues: [1, 2, 3]        # on repo (optional)
  expires_after_days: 60
  last_verified: YYYY-MM-DD
---
```

Section assignment for MEMORY.md:

| Type | Section |
|------|---------|
| `feedback` with always/never/mandatory | `## Daily drivers` |
| `project` | `## Project state` |
| `feedback` (nuanced) | `## Patterns & pitfalls` |
| `reference` | `## References` |

## Phase 4 — Prune and Index

Keep `MEMORY.md` under 200 lines. Each entry is one line under ~150 chars. Remove stale pointers, resolve contradictions.

## Closeout Integration

During Closeout step 5, the synthesis agent runs `datum dream` using `closeout-data.json` and `RETRO.md` as additional signal sources alongside transcripts. The full dream pass — staleness audit, transcript extraction, episodic detection, pruning — runs every closeout, not just the reduced skeleton.
