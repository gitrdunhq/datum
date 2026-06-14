# Phase: Refine

**Goal:** Transform TICKET.md into a SPEC.md that a planner can act on without asking questions.

## Inputs

- `docs/epics/<branch>/TICKET.md` (may contain appended addenda — read the full document)
- GitNexus `context` queries on referenced symbols (if available)
- `CURRENT_STATE.md` (if present)

## Addendum Triage

TICKET.md supports appended scope changes (date-stamped addendum sections). On each Refine run, read the full document and classify each addendum:

**Same scope** — the addendum touches the same files/modules as existing requirements, extends existing behavior, or adds edge cases. Action: incorporate into SPEC.md, re-number requirements.

**Different feature** — zero file overlap with existing requirements, introduces new public API, targets a different module or subsystem. Action: extract to a new entry in `ROADMAP.md` with a one-line summary and the addendum text. Log: `"Triaged to roadmap: <title>"`. Continue Refine with the original scope only.

The decision is structural: check file overlap via GitNexus or grep. If the addendum's implied file set has zero intersection with the existing TICKET requirements, it's a roadmap item.

## Ambiguity Classification

Classify before analysis. This controls how much clarification Refine does.

| Level | Signal | Response |
|---|---|---|
| **High** | Vague or conceptual — intent unclear, architecture unspecified | Full gap analysis. Anchor every question: "I'm assuming X — is that right, or Y?" |
| **Medium** | Clear intent, detectable gaps in failure modes, NFRs, or scope | Ask about detected gaps only. Do not ask what the codebase already answers. |
| **Low** | Specific and concrete — intent, scope, failure modes all clear | Quick verify (step 1 only). Proceed to SPEC if no broken assumptions. |
| **Trivial** | Rename, tooltip, wording fix, single-line config | Trust intent. Write SPEC immediately. |

If you must assume a structural pattern, the ticket is Medium. Ask first.

Batch all questions in one message. Wait for one reply.

## Steps

### 1. Verify assumptions

For each symbol, API, or module referenced in the ticket:
- GitNexus available: `gitnexus context <symbol>` to confirm it exists
- Degraded: grep/AST to locate; record "unverified" in state
- Run impact analysis (`references/impact-analysis.md`) at d=1, d=2
- CRITICAL risk: escalate to reasoning tier for safeguard review. Record in SPEC.

Symbol does not exist → halt, ask user. Do not proceed on broken assumptions.

### 2. Identify gaps

SPEC is sufficient when it answers:
1. What user-visible behavior changes?
2. What are the failure modes and how are they handled?
3. What are the NFRs (latency, size, format)?
4. What is explicitly out of scope?
5. What are the acceptance criteria per requirement?
6. What existing behavior must remain unchanged?

Write all questions to `docs/epics/<branch>/QUESTIONS.md` using `templates/QUESTIONS.md` format:
- Add a `## Refine — YYYY-MM-DD` header
- Number questions sequentially: `### Q1: [Category] Question text?`
- Include `> context` blocks explaining why each question matters
- Leave `[Answer]:` tags empty for the human to fill
- Commit the file and wait for answers

If zero questions arise (Trivial or Low ambiguity), still create QUESTIONS.md with an empty Refine section and a note: "No clarifying questions needed — intent is clear."

In yolo mode with `skippable_if_complete` policy: ask LLM judge if the ticket answers all 6. If yes, proceed. If no, surface gaps and wait.

### 3. Resolve epic directory

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
EPIC_DIR="docs/epics/$BRANCH"
mkdir -p "$EPIC_DIR"
```

TICKET.md should already exist at `$EPIC_DIR/TICKET.md`.

### 4. Write SPEC

Use `assets/templates/SPEC.md` as base. All sections required:

1. Summary (2-3 sentences)
2. Context
3. Requirements (numbered, each with ACs)
4. Failure modes
5. NFRs
6. Out of scope
7. Open questions (empty before gate passes)
8. Blast radius + impact analysis
9. Assumption Audit (table: #, Assumption, Justification, Status, Resolves)
10. Classification Metadata (estimated_files, estimated_loc, clusters_touched, new_public_api, dependency_additions)

Classification Metadata must be filled before the Refine gate — the classifier reads these fields to determine pipeline shape.

Every AC must be testable. If it can't become a property, it's not precise enough.

### 5. Gate

Run: `datum gate refine [--yolo]`

On pass: SPEC written to `docs/epics/<branch>/SPEC.md`, state updated.
On fail: gap list surfaced, return to step 2.

## Outputs

- `docs/epics/<branch>/TICKET.md` — original ticket, preserved
- `docs/epics/<branch>/SPEC.md` — refined requirements, ready for Plan
- `docs/epics/<branch>/QUESTIONS.md` — clarifying questions from Refine (and later Plan)
