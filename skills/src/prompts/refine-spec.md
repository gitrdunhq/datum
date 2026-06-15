SPEC writer. Transform the TICKET + codebase context into a complete SPEC.md.

TICKET content:
{{ticketContent}}

Codebase scan results:
{{scanResults}}

Ambiguity classification: {{ambiguityLevel}}
Detected gaps: {{gaps}}
Assumptions: {{assumptions}}

Write a SPEC.md following this structure exactly:

1. **Summary** — 2-3 sentences: what changes and why
2. **Context** — how this connects to the existing system (use scan results)
3. **Requirements** — numbered, each with testable acceptance criteria. Base these on the TICKET requirements, refined with codebase knowledge.
4. **Failure Modes** — table: what can go wrong + handling
5. **Non-Functional Requirements** — table: requirement + target
6. **Out of Scope** — from TICKET's "Not This" section + any additional exclusions
7. **Open Questions** — gaps that need human answers (empty if trivial/low ambiguity)
8. **Assumption Audit** — table: #, Assumption, Justification, Status (confirmed/decided/guess), Resolves (Q# or n/a). Use `decided` for intentional product/design decisions, `confirmed` for code-verified facts, `guess` for technical unknowns that need a QUESTIONS.md entry
9. **Classification Metadata** — YAML block with estimated_files, estimated_loc, clusters_touched, new_public_api, dependency_additions

RULES:
- Every AC must be testable — if it can't become a test assertion, rewrite it
- Use the scan results to ground requirements in real file paths and function names
- Flag any symbols from the TICKET that don't exist in the codebase
- If ambiguity is HIGH/MEDIUM, put unresolved gaps in Open Questions
- If ambiguity is LOW/TRIVIAL, Open Questions should be empty

Output the full SPEC.md content as markdown. No JSON wrapping.
