# Phase: Refine

**Goal:** Transform docs/TICKET.md into a complete, unambiguous docs/SPEC.md that a planner can act on without asking further questions.

## Inputs

- `docs/TICKET.md` — the raw feature request or bug report
- GitNexus `context` queries on symbols referenced in the ticket (if available)
- `CURRENT_STATE.md` — current project state (if present)

## Ambiguity Classification

Before any analysis, classify the ticket's ambiguity level. This controls how much clarification work Refine does upfront.

| Level | Signal | Response |
|---|---|---|
| **High** | Vague or conceptual — intent is unclear, architecture is unspecified, or the ask could mean multiple different things | Full question sequence (all applicable gap questions below). Do not guess. Anchor every question in a hypothetical baseline: *"I'm assuming X — is that right, or did you mean Y?"* Never hand back a blank questionnaire. |
| **Medium** | Clear intent, detectable gaps — you know what they want but specific failure modes, NFRs, or scope boundaries are missing | Ask only about the detected gaps. Do not ask questions whose answers are inferable from the ticket or codebase. |
| **Low** | Specific and concrete — intent, scope, and failure modes are clear | Quick verify (step 1 only). Proceed directly to docs/SPEC.md if no broken assumptions are found. |
| **Trivial** | Small, obvious change (rename, tooltip, wording fix, single-line config) | Trust user intent. Do not process through full gap analysis. Proceed to docs/SPEC.md immediately. |

**Medium ambiguity rule:** If you have to assume a structural pattern not explicitly stated, the ticket is automatically Medium — ask before assuming.

**Batch questions:** Never ask one question at a time. Surface all gaps in a single message. Wait for one reply before proceeding.

## Steps

### 1. Verify ticket assumptions

For each code symbol, API, or module referenced in docs/TICKET.md:
- If GitNexus is available: run `gitnexus context <symbol>` to confirm it exists and understand its current shape
- If degraded: use AST or grep to locate the symbol; record "unverified by impact graph" in state
- **Run Impact Analysis**: You MUST execute the `datum/references/impact-analysis.md` playbook to assess the blast radius (d=1, d=2).
- **CRITICAL Risk Check**: If the Impact Analysis yields a CRITICAL risk, you MUST immediately invoke the Highest Model available as an Advisor (e.g. o1/o3-mini) to review the impact graph and recommend safeguards. Record these in the SPEC.

If any referenced symbol does not exist: halt with a clarifying question to the user. Do not proceed with a broken assumption.

### Step 2: Identify gaps

A docs/SPEC.md is sufficient when it answers all of:
1. What user-visible behavior changes?
2. What are the failure modes and how are they handled?
3. What are the non-functional requirements (latency, size, format)?
4. What is explicitly out of scope?
5. What are the acceptance criteria for each requirement?
6. What existing behavior must remain unchanged?

For each gap: draft a clarifying question. Batch all questions in a single message to the user. Wait for answers before proceeding.

If `--yolo` is active and the gate policy for `refine_human_review` is `skippable_if_complete`:
- Ask the LLM judge: "Does this docs/TICKET.md answer all 6 questions above sufficiently to skip human review?" 
- If yes: proceed without waiting
- If no: surface the gaps and wait (yolo does not bypass hard information gaps)

### 3. Resolve epic directory

Get the current branch name and create a permanent home for this epic's artifacts:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
EPIC_DIR="docs/epics/$BRANCH"
mkdir -p "$EPIC_DIR"
```

If `docs/TICKET.md` exists, move it into the epic directory so it's preserved alongside the spec:
```bash
mv docs/TICKET.md "$EPIC_DIR/TICKET.md"
```

All subsequent artifacts for this epic go under `$EPIC_DIR`. TASKS.md remains in the repo root (DATUM requirement).

### 4. Write docs/SPEC.md

Use `assets/templates/SPEC.md` as the base. Populate all sections. Every acceptance criterion must be testable — if it can't be turned into a property in docs/PROPERTIES.md, it's not precise enough.

```
docs/SPEC.md sections:
1. Summary (2-3 sentences)
2. Context (why this change, what it connects to)
3. Requirements (numbered, each with acceptance criteria)
4. Failure modes and handling
5. Non-functional requirements
6. Out of scope
7. Open questions (should be empty before gate passes)
8. Blast Radius & Impact Analysis (explicit list of WILL BREAK upstream dependencies and Advisor safeguards if CRITICAL)
```

### 4. Gate

Run `python3 scripts/gate.py refine [--yolo]`

The gate validator:
1. Confirms all 6 sufficiency questions are answered in the SPEC
2. Confirms no open questions remain in section 7
3. If `refine_human_review = required`: presents docs/SPEC.md to user for sign-off
4. If `refine_human_review = skippable_if_complete`: LLM judge evaluates; skips if complete

On pass: write `docs/epics/<branch>/SPEC.md` to disk (permanent, never overwritten by future epics), update state.
On fail: surface gap list, return to step 2.

## Outputs

- `docs/epics/<branch>/TICKET.md` — original ticket, archived alongside the spec
- `docs/epics/<branch>/SPEC.md` — refined requirements, ready for Plan phase

## Failure modes

- TICKET references nonexistent code → halt, ask user for clarification
- SPEC missing boundary/failure-mode answers → gate held, surface gap list
- GitNexus unavailable → log degradation, proceed with grep/AST verification and lower confidence
