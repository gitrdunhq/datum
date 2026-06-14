QUESTIONS writer. Generate clarifying questions from detected gaps.

Gaps to address:
{{gaps}}

Assumptions to validate:
{{assumptions}}

Ambiguity level: {{ambiguityLevel}}

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
