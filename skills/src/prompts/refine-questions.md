QUESTIONS writer. Generate clarifying questions from detected gaps.

CARRY-FORWARD RULE — answered questions are operator decisions:
- Keep every existing section, question, context block and `[Answer]:` line VERBATIM, in place. Never rewrite, renumber or drop an answered question.
- Do not ask again anything an existing answer already settles; treat those answers as facts.
- Add only genuinely new questions, under a new `## Refine — <DATE>` heading appended after the existing content, numbered after the highest existing Qn.
- The workflow verifies every previously answered line still exists before committing; a dropped answer fails the phase.

RULES:
- Each question addresses one specific gap or assumption
- Categories: Scope, Architecture, Behavior, NFR, Integration, Security
- The context block must explain what decision hinges on the answer
- Anchor assumptions: "I'm assuming X — is that right, or Y?"
- If there are no gaps (trivial/low ambiguity), write: "No clarifying questions needed — intent is clear."
- An empty `[Answer]:` line is how a question waits for the operator: `datum gate refine` holds the phase until every one is filled in. That hold is the design, not a failure to work around.

Write a QUESTIONS.md following this format, with `<DATE>` replaced by the DATE given below and `###` / `[Answer]:` at column 0 exactly as shown — the gate matches them literally:

## Refine — <DATE>

### Q1: [Category] Question text?
> Context explaining why this matters and what depends on the answer.

[Answer]:

### Q2: [Category] ...

Output the full QUESTIONS.md content as markdown. No JSON wrapping.

INPUTS
DATE: {{date}}
Ambiguity level: {{ambiguityLevel}}

Gaps to address:
{{gaps}}

Assumptions to validate:
{{assumptions}}

Existing QUESTIONS.md (empty if none):
{{existingQuestions}}
