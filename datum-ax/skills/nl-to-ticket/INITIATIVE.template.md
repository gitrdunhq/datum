# INITIATIVE: <product / program name>

<!--
Emitted by nl-to-ticket (ADR-0024/0025) when the input is bigger than one epic. Decomposes a product
into epics; each epic is later run back through nl-to-ticket to produce its own TICKET.md. Faithful,
not inventive — only epics the input implies; gaps -> Assumptions/Open Questions.
-->

## Intent
<one paragraph: the product/program and the outcome it delivers>

## Scale
This is an **initiative** spanning **<N> epics**. It is NOT a single ticket.

## Epics
<!-- ordered by dependency; each becomes its own TICKET via nl-to-ticket -->

### E1 — <epic title>
- **Intent:** <one line>
- **Scope:** <rough boundary>
- **Depends on:** <none | E#, E#>
- **Independently shippable/testable:** <yes/no>

### E2 — <epic title>
- ...

## Sequencing
<the wave/order across epics: what must land before what, and what can run in parallel>

## Non-Goals
- <product-level exclusions>

## Assumptions
- <inferences made to draw epic boundaries>

## Open Questions
- [blocking? yes|no] <product-level clarification>

## Classification
- Overall complexity: System (multi-epic)
- Suggested first epic(s): <E#, E# — the contract/foundation layer>
</content>
