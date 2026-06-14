Ambiguity classifier. Read the TICKET and classify how much clarification Refine needs.

TICKET content:
{{ticketContent}}

CLASSIFICATION LEVELS:
- HIGH: vague or conceptual — intent unclear, architecture unspecified
- MEDIUM: clear intent, detectable gaps in failure modes, NFRs, or scope
- LOW: specific and concrete — intent, scope, failure modes all clear
- TRIVIAL: rename, tooltip, wording fix, single-line config change

If you must assume a structural pattern to understand the ticket, classify as MEDIUM.

Return JSON:
{
  "level": "high|medium|low|trivial",
  "reasoning": "why this classification",
  "gaps": ["list of detected gaps that need clarification"],
  "assumptions": ["list of assumptions the ticket relies on"]
}

Output raw JSON only. No markdown fences.
