Distill repo scan results into a token-efficient agent preamble.

SCAN RESULTS:
{{scanResults}}

Produce TWO outputs:

## OUTPUT 1: agent-preamble.md (lightweight — every agent gets this)

Write a concise preamble that will be PREPENDED to every agent prompt. Format as llms.txt:

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

## Full Context
- [agent-preamble-full.md](agent-preamble-full.md): expanded rules with code examples and patterns
```

RULES FOR THE PREAMBLE:
- Must be EXACTLY the same text every time for prompt cache hits
- No dynamic content (no dates, no branch names, no file counts)
- Under 60 lines / ~2000 tokens — this gets prepended to EVERY agent call
- Actionable rules only — "use pytest" not "the project has tests"
- Use imperative voice — "Always X" not "The project uses X"

## OUTPUT 2: agent-preamble-full.md (expanded — agents pull this when they need depth)

Write an expanded version with:
- All rules from the preamble PLUS detailed explanations
- Code examples showing the correct pattern for this repo
- Test examples showing the naming/fixture/assertion conventions
- Error handling examples
- Import convention examples
- Anti-patterns to avoid (extracted from linter configs)

The full version can be 200+ lines. It's not cached — agents fetch it on demand.

Return JSON:
{
  "preamble": "full contents of agent-preamble.md as a string",
  "preamble_full": "full contents of agent-preamble-full.md as a string",
  "token_estimate": {"preamble": N, "full": N}
}

Output raw JSON only. No markdown fences.
