Distill repo scan results into a token-efficient agent preamble.

SCAN RESULTS:
{{scanResults}}

## OUTPUT: agent-preamble.md

Write a concise preamble that is PREPENDED to every stage, refine, plan, properties, review, validate and closeout prompt. Format as llms.txt:

```
# [Project Name]

> One-line project description

[Distilled rules — keep under 60 lines total]

## Coding Rules
- [rule]: brief description

## Test Conventions
- [convention]: brief description

## File Conventions
- [convention]: brief description
```

RULES FOR THE PREAMBLE:
- Must be EXACTLY the same text every time for prompt cache hits
- No dynamic content (no dates, no branch names, no file counts)
- Under 60 lines / ~2000 tokens — this gets prepended to EVERY agent call
- Actionable rules only — "use the project's test runner" not "the project has tests"
- Use imperative voice — "Always X" not "The project uses X"

Return JSON:
{
  "preamble": "full contents of agent-preamble.md as a string",
  "token_estimate": {"preamble": N}
}

Output raw JSON only. No markdown fences.
