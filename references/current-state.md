# Current State Generation Playbook

> **@convention** This is the deterministic playbook for generating `CURRENT_STATE.md` during the DATUM Closeout phase, or on-demand to reorient the team.

**Goal:** Fast project orientation — read live state from git and existing docs, and synthesize a concise report of what shipped, what's in flight, and what's next. 

## Step 1 — Read Live Git State
Git is the primary dependency. Use git to check the last 10 commits, active branches, and uncommitted changes:
```bash
git log --oneline -10
git status --short
git branch -v
```

## Step 2 — Read Existing Docs
Read whichever of these state docs exist:
1. `docs/ROADMAP.md` (Planned work)
2. `CHANGELOG.md` (Shipped history)
3. `README.md`

Extract three things:
- **Shipped** — what's declared done (most recent first)
- **In flight** — active branches, WIP sections, ongoing tracks
- **Next** — explicitly planned epics, tasks, or tracks from `ROADMAP.md`

## Step 3 — Staleness Check
Compare the git log against the "Shipped" or equivalent section of the old state doc.
Mark **STALE** if:
- Commits exist whose content isn't reflected in the state doc.
- "What's Next" items appear done per git log.

## Step 4 — Write the Report
Always write `CURRENT_STATE.md` at the project root.

```markdown
# {project-name} — Current State

**Branch:** `{branch}` | **Last updated:** {date} | **Epic:** {current run_id}

---

## Shipped

### {Most Recent Epic Name} (merged — {date})
- {bullet: what shipped}
- {bullet: what shipped}

---

## What's Next
*(Pull directly from the active `docs/ROADMAP.md`)*
{Track A — description}: {one-line summary of work}
{Track B — description}: {one-line summary of work}

---

## In Flight
*(Only include if there are active non-main branches or uncommitted changes)*
- `{branch-name}` — {what it does, inferred from branch name + commits}

---

## Backlog
*(Items parked behind dependencies or planned for much later)*
```

Omit sections that have no content. Keep Shipped bullets tight — one line per item. 

## What NOT To Do
- Don't write code or make non-documentation changes
- Don't hallucinate project status — if a section has no data, omit it or say "unknown"
