# ADR-0023: GitHub Issues as the Human View of the DAG

## Status

Accepted (design)

## Context

The lane DAG / lane-plan (ADR-0010) is the **machine** view of the work. Humans need a view too —
and it should live where humans already work: **GitHub Issues**. A parent **epic issue** holds the
context; **sub-issues** are the subtasks, shown as a **checklist** that gets marked off as lanes land.
GitHub provides native **sub-issues** (parent/child hierarchy + a progress bar) and task-list
checklists, so this is a projection, not a custom UI.

## Decision

- **Epic = a GitHub epic issue.** The TICKET and its requirements/context live in the epic issue body;
  scope changes arrive as **comments** (datum's addendum / ROADMAP triage). **REFINE ingests the epic
  issue + its sub-issues as the primary context source** (ADR-0015).
- **Lanes mirror to sub-issues.** After PLAN, each lane/task is mirrored as a **GitHub sub-issue**
  under the epic; the epic's sub-issue **progress bar + checklist is the human at-a-glance DAG view**
  (nodes + status).
- **Ordering & dependencies via labels (machine-owned).** The DAG is projected to humans with
  **low-cardinality labels** plus body references — deliberately *not* a label per edge:
  - **`wave:N`** — the Kahn wave (ADR-0015). The primary human-visible ordering signal: everything in
    `wave:0` runs first, then `wave:1`, etc. Humans filter/group the epic's sub-issues by `wave:` to
    read execution order.
  - **`status:planned|red|green|skeptic|review|blocked|done`** — lane lifecycle, complementing the
    checkbox / open-closed state.
  - **`route:<shape>`**, **`lane:<id>`** — metadata.
  - **Exact dependency edges live in the sub-issue body** (`Depends on: #12, #15` — GitHub cross-links
    them natively). A **`blocked`** label is auto-applied while any dependency is unmet and removed
    when satisfied. Per-edge labels are avoided on purpose — `wave:N` + body refs carry ordering
    without unbounded label sprawl.
- **The pipeline keeps the projection live.** As a lane advances
  (RED → GREEN → SKEPTIC PASS → eedom approve → committed at wave close), the pipeline **checks the box
  / closes the sub-issue** and posts a concise progress comment. Closing the epic = run done.
- **Sync direction (the load-bearing rule — prevents human/machine edit races):**
  - **Machine-owned: status.** Checkboxes, sub-issue open/closed, **`wave:`/`status:`/`route:`/`lane:`
    and `blocked` labels**, progress comments, and the human-handoff signal. Humans don't hand-edit
    these (they get overwritten).
  - **Human-owned: scope & context.** The epic body requirements, newly added sub-tasks, and
    comments/addenda. The pipeline **reads** these at REFINE/PLAN and reconciles — a human-added
    sub-task becomes a new lane on the next plan; out-of-scope items go to ROADMAP. The pipeline
    **never rewrites human-authored requirement text**; it only writes status and its own comments.
- **Idempotent mapping.** `lane ↔ sub-issue id` is persisted in the libSQL ledger (ADR-0013) so
  resume/re-runs update the **same** issues (no duplicates) — consistent with the resume invariant
  (ADR-0002).
- **Human handoff surfaces here.** A loop `interrupt()` (ADR-0014) appears as an issue comment +
  label/assignee, so a suspension is visible where humans already look.
- Issue/sub-issue/comment text is **untrusted input** → fenced as data, never instructions (ADR-0011).

## Consequences

- Humans get a familiar, zero-extra-tooling view: the epic's checklist with a live progress bar; the
  lane-plan stays the machine source of truth, **projected** to issues.
- GitHub Issues becomes the shared **context + status** substrate (context in, status out).
- Requires GitHub API writes (`issues` / `sub-issues`); these run **orchestrator-side** with the
  GitHub token — **never inside sandboxes** (ADR-0011) — and need egress (ADR-0015).
- The status-vs-scope ownership split is what keeps humans and the pipeline from clobbering each other.
- Ordering is human-visible via **`wave:N` labels** (filter/group by wave); exact edges live in the
  sub-issue body. Label cardinality stays **bounded** (a fixed set of wave/status/route labels), so no
  label sprawl. GitHub Projects remains an optional richer view if a team wants a board.
- Vocabulary alignment (GLOSSARY): EPIC ↔ epic issue, TICKET ↔ issue body, LANE/TASK ↔ sub-issue,
  ROADMAP ↔ out-of-scope addenda, CHECKPOINT ↔ the checklist's marked state.
- Property-test targets: Idempotency (re-projection never duplicates issues), Monotonicity (a checked/
  closed sub-issue isn't silently reopened by a re-run unless its lane actually regressed).
