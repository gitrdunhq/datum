---
name: nl-to-ticket
description: Convert free-form natural-language requests into a structured, faithful TICKET.md (the pipeline's epic intake). Use at the very front of datum-ax, before REFINE/ROUTE, whenever a human gives a task in prose — anything from a one-line idea ("tic tac toe web game") to an already-detailed spec. Produces a deterministic-shape ticket that becomes the GitHub epic issue body.
---

# nl-to-ticket — Natural Language → TICKET.md

You convert arbitrary human text describing a software task into a single, well-formed
`TICKET.md`. This is the **front door** of the datum-ax pipeline (ADR-0024): downstream REFINE,
ROUTE, PLAN, and the GitHub epic issue (ADR-0023) all consume what you emit.

## Prime directive: faithful, not inventive

Capture **exactly** what the human asked — no more, no less.

- **Never invent requirements, features, or scope** the input doesn't state or clearly imply.
- Every inference you make to fill a gap goes under **Assumptions** (explicitly, so a human can
  override it). Every genuine unknown goes under **Open Questions**.
- **Preserve all detail the human gave.** If the input is already structured or rich, map its content
  into the template — do not rewrite, reinterpret, or drop it.
- **Scale to the input.** A one-liner yields a short ticket with more Open Questions; a detailed spec
  yields a richly populated ticket with few. **Do not pad** a small ask into fake-detailed bloat, and
  do not **truncate** a large one.

If you cannot honestly fill a section from the input, leave it minimal and push the gap to
Assumptions/Open Questions. A short honest ticket beats a long hallucinated one.

## Step 0 — Scale detection (do this FIRST): task | epic | initiative

Before writing anything, decide the **scale** of the request. Cramming a whole product into one
`TICKET.md` is the cardinal failure — every downstream phase will choke.

| Scale | Looks like | Emit |
|-------|-----------|------|
| **task** | one small change, single concern (`Patch`) | a single `TICKET.md` (lean) |
| **epic** | one coherent deliverable with a unified set of acceptance criteria (`Feature`/`System`) | a single `TICKET.md` |
| **initiative / product** | a product, platform, or program; **multiple independent deliverables**; no single coherent AC set; would need many epics to finish | an **`INITIATIVE.md`** that decomposes into epics — **NOT** one ticket |

Signals it's an **initiative** (any of these → decompose, don't cram):
- It names a *product/platform/system* ("build a CRM", "an autonomous coding pipeline").
- It implies several distinct user-facing capabilities that could ship and be tested independently.
- A single honest Acceptance-Criteria list would be unreasonably long or span unrelated concerns.
- Different parts have different stacks, owners, or lifecycles.

When it's an initiative, produce `INITIATIVE.md` (see `INITIATIVE.template.md`): the product intent,
then a list of **epics**, each with a one-line intent, rough scope, and dependencies/sequencing. Each
epic is later run back through this same skill to produce its own `TICKET.md`. **Say so explicitly** —
e.g. "This is an initiative spanning N epics; here is the breakdown" — rather than silently emitting a
giant ticket.

## Procedure (for a task/epic — produces TICKET.md)

1. **Read everything.** State the core intent in one sentence.
2. **Detect input richness** (drives how much you infer vs. ask): is this a vague idea, a moderate
   description, or a developed spec?
3. **Extract, don't author:**
   - functional **Requirements** (what it must do) — close to the user's own words;
   - **Constraints & NFRs** (stack, platform, performance, security, deadlines) — only if stated/implied;
   - **Non-Goals** — anything explicitly excluded.
4. **Derive Acceptance Criteria** that are **concrete and testable** — they become RED tests and
   PROPERTIES downstream (ADR-0016). Vague ACs are a defect.
5. **Flag the gaps:** inferences → **Assumptions**; unknowns → **Open Questions** (mark each
   blocking or non-blocking).
6. **Classify** (seeds ROUTE / tokenomics, ADR-0018) using the rubrics below.
7. **Emit `TICKET.md`** using the exact section schema in `TICKET.template.md`. Keep the section order
   and headings stable — downstream parses it.

## Classification rubrics

- **Complexity:** `Patch` (small, <~50 LOC, one concern) · `Feature` (standard, multi-file) ·
  `System` (cross-cutting, many modules).
- **Scope:** `narrow` (one module) · `moderate` (a few) · `broad` (cross-cutting).
- **Ambiguity:** `trivial` (rename/config) · `low` (specific) · `medium` (gaps detected) ·
  `high` (vague intent).
- **Suggested ROUTE:** `feature` (full) · `hotfix` (small scoped fix) · `spike` (explore) ·
  `audit` (assess existing) · `refine-only` (just clarify). Pick the leanest route that fits — an
  over-heavy route wastes tokens (ADR-0009).

## Anti-patterns (reject your own draft if it does these)

- **Cramming an initiative/product into a single `TICKET.md`** instead of decomposing into epics.
- Scope inflation / hallucinated requirements.
- Vague, untestable acceptance criteria.
- Dropping detail the human provided.
- Over-structuring a trivial ask, or under-structuring a developed one.
- Presenting an inference as a stated requirement (it belongs in Assumptions).

## Example — minimal input

**Input:** `make a tic tac toe web game`

**Output (abridged):**

```markdown
# TICKET: Tic-tac-toe web game

## Intent
Build a browser-playable tic-tac-toe game for two human players on one device.

## Requirements
- 3×3 grid playable in a web browser.
- Two players alternate X and O by clicking empty cells.
- Detect and announce a win (any row/column/diagonal) and a draw.
- Reset / new-game control.

## Non-Goals
- (none stated)

## Acceptance Criteria
- [ ] Clicking an empty cell places the current player's mark and passes the turn.
- [ ] Clicking an occupied cell is rejected (board unchanged).
- [ ] A completed line (8 cases) is detected and the winner announced.
- [ ] A full board with no line is announced as a draw.
- [ ] Reset returns to an empty board, X to move.

## Constraints & NFRs
- Runs client-side in a modern browser (assumption — see below).

## Assumptions
- Two humans, hot-seat (no AI opponent or networking) — not stated.
- Vanilla HTML/CSS/JS unless a framework is requested.

## Open Questions
- [blocking? no] Any framework preference (React/Svelte/vanilla)?
- [blocking? no] Single-device hot-seat, or online multiplayer?
- [blocking? no] Styling/visual requirements?

## Classification
- Complexity: Feature
- Scope: narrow
- Ambiguity: medium
- Suggested route: feature
```

Note how the one-liner produced a *short* ticket: real ACs derived from the obvious rules, every
inference parked in Assumptions, the genuine forks raised as non-blocking Open Questions — and **no
invented scope** (no scoreboard, no AI, no accounts).

## Output

Write the result to `TICKET.md` (it becomes the GitHub epic issue body, ADR-0023). Then stop — REFINE
and ROUTE take it from here. A human reviews/edits the ticket (scope is human-owned, ADR-0023) before
the deterministic pipeline proceeds.
