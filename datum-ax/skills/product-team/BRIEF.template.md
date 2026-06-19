# BRIEF: <concise title>

<!--
The discovery handoff artifact, emitted by product-team-shape. Markdown for humans; the canonical
machine form is brief.json (keep them consistent — JSON is source of truth). Faithful: everything
here traces to clarify/research/skeptic. Inferences -> Assumptions; unknowns -> Open Questions.

brief.json shape (the machine contract):
{
  "title": str,
  "one_liner": str,
  "problem": str, "why_now": str|null,
  "users": [str],
  "intent": str,
  "success_metrics": [str],
  "scope": { "in": [str], "out": [str], "non_goals": [str] },
  "constraints": [str],
  "prior_art": [str],
  "research_ledger": { "verified": [str], "plausible": [str], "fabricated": [str] },
  "key_risks": [ { "risk": str, "impact": "high|med|low", "mitigation": str } ],
  "descope": [str],
  "assumptions": [str],
  "open_questions": [ { "q": str, "blocking": bool } ],
  "scale": "task|epic|initiative", "scale_rationale": str,
  "recommended_next": "architect|planner|nl-to-ticket|spike|do-not-build-yet",
  "confidence": "high|medium|low", "confidence_note": str
}
-->

## One-liner
<the idea in a sentence>

## Problem & why-now
<what hurts, for whom, and why it matters now>

## Users
- <primary> / <secondary>

## Intent (desired outcome)
<the change in the world if this works>

## Success metrics
- <observable signal it worked>

## Scope
- **In:** <...>
- **Out:** <...>
- **Non-goals:** <...>

## Constraints & NFRs
- <platform / stack / time / budget / compliance>

## Prior art & research
- <relevant existing solutions / standard approach>
- Ledger: see `RESEARCH-LEDGER.md` (verified vs fabricated).

## Key risks
- <risk> — impact <high/med/low> — mitigation: <...>

## Descope recommendations
- <what to cut to ship the 80%>

## Assumptions
- <explicit, overridable inference>

## Open questions
- [blocking? yes|no] <...>

## Scale call
- **<task | epic | initiative>** — <rationale>. <if initiative: likely first slice>

## Recommended next
- **<architect | planner | nl-to-ticket | spike | do-not-build-yet>** — <why>

## Confidence
- **<high | medium | low>** — <what would raise it>
</content>
