# Pre-Dev Phase: Handoff

**Goal:** Create the strict contract (`docs/TICKET.md`) that acts as the hard boundary between Product Ideation and the Engineering Factory Floor.

## Context
**CORE PHILOSOPHY: DETERMINISM IS PARAMOUNT. LLM IS FOR REASONING AND CREATIVITY.**
The Engineering Pipeline (`datum go`) relies on `docs/TICKET.md` as its absolute source of truth. It does not care about ideation notes, vibes, or creative guesses. The pipeline orchestration is 100% deterministic. The LLM's job here is to use its reasoning and creativity to translate messy human needs into an unambiguous, rigid contract.

## Process
1. Read `docs/ideation/PRD.md`.
2. Distill the PRD into a strict, unambiguous engineering ticket.
3. Ensure the ticket has a clear "What", "Why", and "Acceptance Criteria".

## Output
Create `docs/TICKET.md`.
This is a HARD BOUNDARY. Once `docs/TICKET.md` is generated, the Product Pipeline Halts.
The user can now run `datum go` to initiate the Engineering Pipeline (Refine phase).
