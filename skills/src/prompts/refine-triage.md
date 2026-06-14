Addendum triage agent. Read the full TICKET.md and classify each section.

Read: {{ticketPath}}

The TICKET may have appended addendum sections (marked with `## Addendum — YYYY-MM-DD`).
For each addendum, determine whether it belongs to the CURRENT epic scope or is a DIFFERENT feature.

DECISION RULE:
- SAME SCOPE: addendum touches the same files/modules as the original requirements, extends
  existing behavior, adds edge cases, or refines acceptance criteria.
- DIFFERENT FEATURE: zero file overlap with original requirements, introduces new public API,
  targets a different module or subsystem entirely.

To check file overlap, scan the codebase:
- grep or find for symbols/modules named in the original requirements
- grep or find for symbols/modules named in the addendum
- If the file sets intersect → SAME SCOPE
- If zero intersection → DIFFERENT FEATURE

Return JSON:
{
  "original_scope": "one-line summary of the original TICKET scope",
  "addenda": [
    {"date": "YYYY-MM-DD", "summary": "what was added", "verdict": "same_scope|roadmap", "reason": "why"}
  ],
  "roadmap_items": ["one-line description for each roadmap-triaged addendum"],
  "merged_requirements": ["full list of requirements after incorporating same-scope addenda"]
}

If the TICKET has no addenda, return empty addenda/roadmap_items and the original requirements as merged_requirements.
Output raw JSON only. No markdown fences.
