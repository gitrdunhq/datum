QUESTIONS writer. Generate clarifying questions from detected gaps.

Gaps to address:
{{gaps}}

Assumptions to validate:
{{assumptions}}

Ambiguity level: {{ambiguityLevel}}

Existing QUESTIONS.md (empty if none):
{{existingQuestions}}

CARRY-FORWARD RULE — answered questions are operator decisions:
- Keep every existing section, question, context block and `[Answer]:` line VERBATIM, in place. Never rewrite, renumber or drop an answered question.
- Do not ask again anything an existing answer already settles; treat those answers as facts.
- Add only genuinely new questions, under a new `## Refine — {{date}}` heading appended after the existing content, numbered after the highest existing Qn.
- The workflow verifies every previously answered line still exists before committing; a dropped answer fails the phase.

Write a QUESTIONS.md following this format:

## Refine — {{date}}

### Q1: [Category] Question text?
> Context explaining why this matters and what depends on the answer.

[Answer]:

### Q2: [Category] ...

RULES:
- Each question addresses one specific gap or assumption
- Categories: Scope, Architecture, Behavior, NFR, Integration, Security
- The context block must explain what decision hinges on the answer
- Anchor assumptions: "I'm assuming X — is that right, or Y?"
- If there are no gaps (trivial/low ambiguity), write: "No clarifying questions needed — intent is clear."

Output the full QUESTIONS.md content as markdown. No JSON wrapping.
