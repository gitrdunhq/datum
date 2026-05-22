# Steering Shape

Use a compact, machine-friendly markdown shape.

## Required sections

```md
# Coding Steering

## Core Rules

### CS-001
Rule: ...
Trigger: ...
Do: ...
Check: ...
Evidence: ...

## Repo-Local Rules
```

## Field rules

- `Rule`: imperative requirement, one line when possible
- `Trigger`: detectable smell, boundary, or failure mode
- `Do`: required action or replacement pattern
- `Check`: observable acceptance test, threshold, or validation path
- `Evidence`: short relative path refs only

## Compression policy

- Merge candidates when the required action is the same.
- Split only when enforcement differs.
- Omit low-signal or redundant rules.
- Do not add narrative transitions between rules.

## Style guidance policy

If a candidate cannot be written with `Trigger` and `Check`, it is not a
steering rule. Omit it by default.

## Token efficiency rules

- Prefer one-line fields
- Keep evidence to one or two refs per rule
- Use stable IDs: `CS-001`, `CS-002`, ...
- No executive summary unless requested
- No long quoted excerpts
- No examples unless the rule is non-obvious

## Optional sections

- `## Style Notes` only if explicitly requested
- `## Prompt Block` only if explicitly requested
