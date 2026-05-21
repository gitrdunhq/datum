# Prompt Template

Use this only when the user explicitly asks for a reusable downstream prompt.

```text
Mine the target folder for repeated coding failures, structural drift, and
enforcement-worthy patterns.

Emit only SMART-T steering rules:
- Specific
- Measurable
- Actionable
- Relevant
- Testable

For each rule, output only:
- Rule
- Trigger
- Do
- Check
- Evidence

Reject any candidate rule that cannot meet that bar. If it cannot be expressed
with a concrete trigger and acceptance check, classify it as style guidance and
omit it by default.

Optimize for minimum sufficient doctrine:
- no arbitrary rule-count cap
- merge duplicates by enforcement action
- sort by severity, recurrence, and preventive value
- keep output token-efficient for LLM ingestion
- use relative evidence paths, not long quotes
- separate Core Rules from Repo-Local Rules

Do not invent evidence. If mining coverage is partial or thin, say so.
```
